//! Reader for the Designer's model XSDs (`aomodel-<version>-<modelType>.xsd`): which elements a
//! model type may contain, their XSD types, enum values and which types are repeatable lists.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ComplexType {
    /// Child elements in XSD order: (element name, XSD type name).
    pub elements: Vec<(String, String)>,
    /// `true` for `sequence`/`choice` containers (repeated children, e.g. `entityFields`),
    /// `false` for `all` property bags.
    pub is_list: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Schema {
    /// Model type (root element, e.g. `entity`) -> its XSD type (e.g. `entityType`).
    pub roots: BTreeMap<String, String>,
    pub complex: BTreeMap<String, ComplexType>,
    /// Simple types restricted to an enumeration -> allowed values in XSD order.
    pub enums: BTreeMap<String, Vec<String>>,
}

fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key.as_bytes())
        .map(|a| String::from_utf8_lossy(&a.value).into_owned())
}

fn local(name: &[u8]) -> &[u8] {
    match name.iter().position(|&c| c == b':') {
        Some(i) => &name[i + 1..],
        None => name,
    }
}

impl Schema {
    /// Merges one XSD document into this schema. All Designer XSDs share the same type
    /// definitions and differ in their root element, so merging is a union.
    pub fn add_xsd(&mut self, text: &str) -> Result<(), String> {
        let mut reader = Reader::from_str(text);
        let mut depth = 0usize;
        let mut root_element: Option<String> = None;
        let mut complex: Option<(String, ComplexType)> = None;
        let mut simple: Option<(String, Vec<String>)> = None;

        loop {
            let event = reader.read_event().map_err(|e| e.to_string())?;
            let (start, is_empty) = match &event {
                Event::Start(e) => (Some(e.clone()), false),
                Event::Empty(e) => (Some(e.clone()), true),
                Event::End(_) => {
                    depth -= 1;
                    if depth == 1 {
                        if let Some((n, t)) = complex.take() {
                            self.complex.insert(n, t);
                        }
                        if let Some((n, v)) = simple.take() {
                            if !v.is_empty() {
                                self.enums.insert(n, v);
                            }
                        }
                        root_element = None;
                    }
                    continue;
                }
                Event::Eof => break,
                _ => continue,
            };
            let Some(e) = start else { continue };
            let name = local(e.name().as_ref()).to_vec();
            match (depth, name.as_slice()) {
                (1, b"element") => root_element = attr(&e, "name"),
                (1, b"complexType") => complex = attr(&e, "name").map(|n| (n, ComplexType::default())),
                (1, b"simpleType") => simple = attr(&e, "name").map(|n| (n, Vec::new())),
                (_, b"extension") if root_element.is_some() => {
                    if let (Some(root), Some(base)) = (root_element.clone(), attr(&e, "base")) {
                        self.roots.insert(root, base);
                    }
                }
                (_, b"sequence") | (_, b"choice") => {
                    if let Some((_, t)) = complex.as_mut() {
                        t.is_list = true;
                    }
                }
                (_, b"element") if depth >= 2 => {
                    if let Some((_, t)) = complex.as_mut() {
                        if let (Some(n), Some(ty)) = (attr(&e, "name"), attr(&e, "type")) {
                            t.elements.push((n, ty));
                        }
                    }
                }
                (_, b"enumeration") => {
                    if let (Some((_, v)), Some(val)) = (simple.as_mut(), attr(&e, "value")) {
                        v.push(val);
                    }
                }
                _ => {}
            }
            if !is_empty {
                depth += 1;
            } else if depth == 1 {
                if let Some((n, t)) = complex.take() {
                    self.complex.insert(n, t);
                }
                simple = None;
            }
        }
        Ok(())
    }

    /// XSD type of the element reached by following `tags` (element names, indices dropped)
    /// from the root of `model_type`. List containers are stepped through transparently.
    pub fn type_at(&self, model_type: &str, tags: &[String]) -> Option<String> {
        let mut current = self.roots.get(model_type)?.clone();
        for tag in tags {
            let ct = self.complex.get(&current)?;
            current = ct.elements.iter().find(|(n, _)| n == tag)?.1.clone();
        }
        Some(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <xsd:element name="thing">
    <xsd:complexType><xsd:complexContent><xsd:extension base="thingType">
      <xsd:attribute name="VERSION" type="xsd:string" use="required" />
    </xsd:extension></xsd:complexContent></xsd:complexType>
  </xsd:element>
  <xsd:complexType name="thingType">
    <xsd:all>
      <xsd:element name="title" type="stringType" minOccurs="0" />
      <xsd:element name="mode" type="emodeType" minOccurs="0">
        <xsd:annotation><xsd:documentation>default</xsd:documentation></xsd:annotation>
      </xsd:element>
      <xsd:element name="parts" type="PartsListType" minOccurs="0" />
    </xsd:all>
  </xsd:complexType>
  <xsd:complexType name="PartsListType">
    <xsd:sequence><xsd:choice minOccurs="0" maxOccurs="unbounded">
      <xsd:element name="part" type="partType" />
    </xsd:choice></xsd:sequence>
  </xsd:complexType>
  <xsd:complexType name="partType"><xsd:all><xsd:element name="name" type="stringType" /></xsd:all></xsd:complexType>
  <xsd:complexType name="booleanType"><xsd:attribute name="v" type="xsd:boolean" use="required" /></xsd:complexType>
  <xsd:simpleType name="emodeType"><xsd:restriction base="xsd:string">
    <xsd:enumeration value="A" /><xsd:enumeration value="B" />
  </xsd:restriction></xsd:simpleType>
  <xsd:simpleType name="stringType"><xsd:restriction base="xsd:string" /></xsd:simpleType>
</xsd:schema>"#;

    #[test]
    fn parses_roots_types_lists_and_enums() {
        let mut s = Schema::default();
        s.add_xsd(FIXTURE).unwrap();
        assert_eq!(s.roots.get("thing").map(String::as_str), Some("thingType"));
        let thing = &s.complex["thingType"];
        assert!(!thing.is_list);
        assert_eq!(
            thing.elements.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
            vec!["title", "mode", "parts"]
        );
        assert!(s.complex["PartsListType"].is_list);
        assert_eq!(s.enums["emodeType"], vec!["A", "B"]);
        assert!(!s.enums.contains_key("stringType"));
        assert!(s.complex.contains_key("booleanType"));
        assert_eq!(
            s.type_at("thing", &["parts".into(), "part".into()]).as_deref(),
            Some("partType")
        );
    }
}
