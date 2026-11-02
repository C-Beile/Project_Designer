//! Minimal reader for the metadata parts of a Java class file: constant pool, class hierarchy
//! names, field names with their runtime-visible annotations, and the enum-constant to
//! resource-key pairing of an enum's static initializer.
//!
//! This deliberately reads metadata only (Chef-Prompt §4.2: no decompiling). The property
//! sheet's groups, positions and descriptions are annotation constants on the Designer's own
//! datamodel classes; nothing here reconstructs program logic. The one look into method code is
//! `enum_resource_keys`, which walks the instruction stream of `<clinit>` only to pair each enum
//! constant with the resource constant passed to its constructor - an instruction-length walk,
//! not an interpreter.

use std::collections::HashMap;

#[derive(Debug, Clone)]
enum Constant {
    Utf8(String),
    Int(i32),
    Class(u16),
    Ref { class: u16, name_and_type: u16 },
    NameAndType { name: u16, descriptor: u16 },
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ElementValue {
    Int(i32),
    Str(String),
    Enum { type_name: String, constant: String },
    Class(String),
    Annotation(Annotation),
    Array(Vec<ElementValue>),
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Annotation {
    /// Simple name of the annotation type, e.g. `EDITOR`, `JsonSchemaElement`.
    pub type_name: String,
    pub elements: Vec<(String, ElementValue)>,
}

impl Annotation {
    pub fn get(&self, key: &str) -> Option<&ElementValue> {
        self.elements.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    pub descriptor: String,
    pub annotations: Vec<Annotation>,
}

#[derive(Debug, Clone)]
pub struct ClassFile {
    /// Internal name with slashes, e.g. `de/adito/.../NeonContextDataModel`.
    pub this_class: String,
    pub super_class: Option<String>,
    pub interfaces: Vec<String>,
    pub fields: Vec<Field>,
    pub annotations: Vec<Annotation>,
    cp: Vec<Constant>,
    clinit_code: Option<Vec<u8>>,
}

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn u1(&mut self) -> Result<u8, String> {
        let v = *self.b.get(self.p).ok_or("unexpected end of class file")?;
        self.p += 1;
        Ok(v)
    }
    fn u2(&mut self) -> Result<u16, String> {
        Ok(((self.u1()? as u16) << 8) | self.u1()? as u16)
    }
    fn u4(&mut self) -> Result<u32, String> {
        Ok(((self.u2()? as u32) << 16) | self.u2()? as u32)
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.p + n > self.b.len() {
            return Err("unexpected end of class file".into());
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
}

impl ClassFile {
    pub fn parse(bytes: &[u8]) -> Result<ClassFile, String> {
        let mut r = Reader { b: bytes, p: 0 };
        if r.u4()? != 0xCAFE_BABE {
            return Err("not a class file".into());
        }
        r.u2()?;
        r.u2()?;
        let count = r.u2()? as usize;
        let mut cp = vec![Constant::Other; count.max(1)];
        let mut i = 1;
        while i < count {
            let tag = r.u1()?;
            cp[i] = match tag {
                1 => {
                    let len = r.u2()? as usize;
                    Constant::Utf8(decode_modified_utf8(r.take(len)?))
                }
                3 => Constant::Int(r.u4()? as i32),
                4 => {
                    r.u4()?;
                    Constant::Other
                }
                5 | 6 => {
                    r.u4()?;
                    r.u4()?;
                    i += 1;
                    Constant::Other
                }
                7 => Constant::Class(r.u2()?),
                8 => {
                    r.u2()?;
                    Constant::Other
                }
                9..=11 => Constant::Ref { class: r.u2()?, name_and_type: r.u2()? },
                12 => Constant::NameAndType { name: r.u2()?, descriptor: r.u2()? },
                15 => {
                    r.u1()?;
                    r.u2()?;
                    Constant::Other
                }
                16 | 19 | 20 => {
                    r.u2()?;
                    Constant::Other
                }
                17 | 18 => {
                    r.u2()?;
                    r.u2()?;
                    Constant::Other
                }
                other => return Err(format!("unknown constant pool tag {other}")),
            };
            i += 1;
        }

        let mut cf = ClassFile {
            this_class: String::new(),
            super_class: None,
            interfaces: Vec::new(),
            fields: Vec::new(),
            annotations: Vec::new(),
            cp,
            clinit_code: None,
        };
        r.u2()?;
        cf.this_class = cf.class_name(r.u2()?).unwrap_or_default();
        let sup = r.u2()?;
        cf.super_class = if sup == 0 { None } else { cf.class_name(sup) };
        for _ in 0..r.u2()? {
            let idx = r.u2()?;
            if let Some(n) = cf.class_name(idx) {
                cf.interfaces.push(n);
            }
        }
        for _ in 0..r.u2()? {
            r.u2()?;
            let name = cf.utf8(r.u2()?).unwrap_or_default();
            let descriptor = cf.utf8(r.u2()?).unwrap_or_default();
            let (annotations, _) = cf.read_attributes(&mut r)?;
            cf.fields.push(Field { name, descriptor, annotations });
        }
        for _ in 0..r.u2()? {
            r.u2()?;
            let name = cf.utf8(r.u2()?).unwrap_or_default();
            r.u2()?;
            let (_, code) = cf.read_attributes(&mut r)?;
            if name == "<clinit>" {
                cf.clinit_code = code;
            }
        }
        let (annotations, _) = cf.read_attributes(&mut r)?;
        cf.annotations = annotations;
        Ok(cf)
    }

    fn utf8(&self, idx: u16) -> Option<String> {
        match self.cp.get(idx as usize)? {
            Constant::Utf8(s) => Some(s.clone()),
            _ => None,
        }
    }

    fn class_name(&self, idx: u16) -> Option<String> {
        match self.cp.get(idx as usize)? {
            Constant::Class(n) => self.utf8(*n),
            _ => None,
        }
    }

    /// (owner class, field name, descriptor) of a field reference constant.
    fn field_ref(&self, idx: u16) -> Option<(String, String, String)> {
        match self.cp.get(idx as usize)? {
            Constant::Ref { class, name_and_type } => match self.cp.get(*name_and_type as usize)? {
                Constant::NameAndType { name, descriptor } => {
                    Some((self.class_name(*class)?, self.utf8(*name)?, self.utf8(*descriptor)?))
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// Returns the runtime-visible annotations and, for a method, its `Code` bytes.
    fn read_attributes(&self, r: &mut Reader) -> Result<(Vec<Annotation>, Option<Vec<u8>>), String> {
        let mut annotations = Vec::new();
        let mut code = None;
        for _ in 0..r.u2()? {
            let name = self.utf8(r.u2()?).unwrap_or_default();
            let len = r.u4()? as usize;
            let body = r.take(len)?;
            match name.as_str() {
                "RuntimeVisibleAnnotations" => {
                    let mut ar = Reader { b: body, p: 0 };
                    for _ in 0..ar.u2()? {
                        annotations.push(self.read_annotation(&mut ar)?);
                    }
                }
                "Code" => {
                    let mut cr = Reader { b: body, p: 0 };
                    cr.u2()?;
                    cr.u2()?;
                    let code_len = cr.u4()? as usize;
                    code = Some(cr.take(code_len)?.to_vec());
                }
                _ => {}
            }
        }
        Ok((annotations, code))
    }

    fn read_annotation(&self, r: &mut Reader) -> Result<Annotation, String> {
        let type_name = simple_type_name(&self.utf8(r.u2()?).unwrap_or_default());
        let mut elements = Vec::new();
        for _ in 0..r.u2()? {
            let key = self.utf8(r.u2()?).unwrap_or_default();
            elements.push((key, self.read_element_value(r)?));
        }
        Ok(Annotation { type_name, elements })
    }

    fn read_element_value(&self, r: &mut Reader) -> Result<ElementValue, String> {
        let tag = r.u1()?;
        Ok(match tag {
            b'B' | b'C' | b'I' | b'S' | b'Z' => match self.cp.get(r.u2()? as usize) {
                Some(Constant::Int(v)) => ElementValue::Int(*v),
                _ => ElementValue::Other,
            },
            b'D' | b'F' | b'J' => {
                r.u2()?;
                ElementValue::Other
            }
            b's' => ElementValue::Str(self.utf8(r.u2()?).unwrap_or_default()),
            b'e' => {
                let type_name = simple_type_name(&self.utf8(r.u2()?).unwrap_or_default());
                let constant = self.utf8(r.u2()?).unwrap_or_default();
                ElementValue::Enum { type_name, constant }
            }
            b'c' => ElementValue::Class(descriptor_to_internal(&self.utf8(r.u2()?).unwrap_or_default())),
            b'@' => ElementValue::Annotation(self.read_annotation(r)?),
            b'[' => {
                let n = r.u2()?;
                let mut items = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    items.push(self.read_element_value(r)?);
                }
                ElementValue::Array(items)
            }
            other => return Err(format!("unknown annotation element tag {}", other as char)),
        })
    }

    /// For an enum class: which constant of `resource_class` (simple name) each enum constant
    /// hands to its constructor. Used to find the display text of a property group: the enum
    /// `SheetTabCategory.RECORDCONTAINER` is built with `EStaticResources.TITLE_RECORDCONTAINER`.
    pub fn enum_resource_keys(&self, resource_class: &str) -> Vec<(String, String)> {
        let Some(code) = &self.clinit_code else { return Vec::new() };
        let own_descriptor = format!("L{};", self.this_class);
        let mut out = Vec::new();
        let mut pending: Option<String> = None;
        let mut pc = 0usize;
        while pc < code.len() {
            let op = code[pc];
            let operand = |o: usize| -> u16 { ((code.get(pc + o).copied().unwrap_or(0) as u16) << 8) | code.get(pc + o + 1).copied().unwrap_or(0) as u16 };
            match op {
                0xb2 => {
                    if let Some((owner, name, _)) = self.field_ref(operand(1)) {
                        if simple_type_name(&owner) == resource_class && pending.is_none() {
                            pending = Some(name);
                        }
                    }
                }
                0xb3 => {
                    if let Some((owner, name, descriptor)) = self.field_ref(operand(1)) {
                        if owner == self.this_class && descriptor == own_descriptor {
                            if let Some(key) = pending.take() {
                                out.push((name, key));
                            }
                        }
                    }
                    pending = None;
                }
                _ => {}
            }
            pc += instruction_length(code, pc);
        }
        out
    }
}

/// Length of the JVM instruction at `pc`, including operands and switch padding.
fn instruction_length(code: &[u8], pc: usize) -> usize {
    let read_i32 = |at: usize| -> i64 {
        if at + 4 > code.len() {
            return 0;
        }
        i32::from_be_bytes([code[at], code[at + 1], code[at + 2], code[at + 3]]) as i64
    };
    match code[pc] {
        0x10 | 0x12 | 0x15..=0x19 | 0x36..=0x3a | 0xa9 | 0xbc => 2,
        0x11 | 0x13 | 0x14 | 0x84 | 0x99..=0xa8 | 0xb2..=0xb8 | 0xbb | 0xbd | 0xc0 | 0xc1 | 0xc6 | 0xc7 => 3,
        0xc5 => 4,
        0xb9 | 0xba | 0xc8 | 0xc9 => 5,
        0xc4 => {
            if code.get(pc + 1) == Some(&0x84) {
                6
            } else {
                4
            }
        }
        0xaa => {
            let base = (pc + 4) & !3;
            let low = read_i32(base + 4);
            let high = read_i32(base + 8);
            let n = (high - low + 1).max(0) as usize;
            base + 12 + n * 4 - pc
        }
        0xab => {
            let base = (pc + 4) & !3;
            let n = read_i32(base + 4).max(0) as usize;
            base + 8 + n * 8 - pc
        }
        _ => 1,
    }
}

fn simple_type_name(descriptor_or_name: &str) -> String {
    let internal = if descriptor_or_name.starts_with('L') && descriptor_or_name.ends_with(';') {
        &descriptor_or_name[1..descriptor_or_name.len() - 1]
    } else {
        descriptor_or_name
    };
    internal.rsplit('/').next().unwrap_or(internal).to_string()
}

fn descriptor_to_internal(descriptor: &str) -> String {
    descriptor.trim_start_matches('L').trim_end_matches(';').to_string()
}

/// Java's "modified UTF-8" differs from UTF-8 only for NUL and supplementary characters, which
/// do not occur in property names or descriptions; a lossy decode is sufficient here.
fn decode_modified_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub type ClassIndex = HashMap<String, ClassFile>;
