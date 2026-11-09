//! `cargo run -p platform --example ppk_convert -- key.ppk out_key`: writes the OpenSSH copy of a .ppk key.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).expect("read the key");
    match platform::ppk::ppk_to_openssh(&text) {
        Ok(key) => std::fs::write(&args[2], key).expect("write the key"),
        Err(e) => eprintln!("{e}"),
    }
}
