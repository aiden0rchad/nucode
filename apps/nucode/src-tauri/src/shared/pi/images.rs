use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
};

const LIMIT: u64 = 20 * 1024 * 1024;
const UNAVAILABLE: &str = "Image preview unavailable: the saved image is missing or invalid.";

/// The blob a content-addressed image reference names, if the reference is well formed and the file
/// is a regular file of a showable size directly inside the blob directory.
fn blob_path(reference: &str, mime: &Value, directory: &Path) -> Option<(PathBuf, String)> {
    let hash = reference.strip_prefix("blob:sha256:")?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    if !matches!(
        mime.as_str(),
        Some("image/png" | "image/jpeg" | "image/webp" | "image/gif")
    ) {
        return None;
    }
    let root = directory.canonicalize().ok()?;
    let path = root.join(hash).canonicalize().ok()?;
    if path.parent() != Some(root.as_path()) {
        return None;
    }
    let meta = path.metadata().ok()?;
    (meta.is_file() && meta.len() <= LIMIT).then_some((path, hash.to_owned()))
}

fn blob_parts(message: &mut Value) -> impl Iterator<Item = (&mut Value, String)> {
    message
        .get_mut("content")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "image")
        .filter_map(|part| {
            let reference = part["data"].as_str().filter(|s| s.starts_with("blob:"))?.to_owned();
            Some((part, reference))
        })
}

fn read_blob(path: PathBuf, hash: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(LIMIT + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= LIMIT && format!("{:x}", Sha256::digest(&bytes)) == hash).then_some(bytes)
}

// OMP stores image bytes under its isolated agent home, leaving content-addressed
// references in session JSON. Hydrate for display without rewriting the session.
pub(super) fn restore(message: &mut Value, directory: &Path) {
    for (part, reference) in blob_parts(message) {
        let bytes = blob_path(&reference, &part["mimeType"], directory)
            .and_then(|(path, hash)| read_blob(path, &hash));
        if let Some(bytes) = bytes {
            part["data"] = json!(STANDARD.encode(bytes));
        } else {
            *part = json!({"type":"text","text":UNAVAILABLE});
        }
    }
}

// A saved conversation can hold hundreds of megabytes of screenshots, and the window shows few of them.
// Keep a usable reference in place of the bytes, which `load` supplies when an image is on screen.
// The checksum is verified there; here a reference is only kept while its blob is present.
pub(super) fn reference(message: &mut Value, directory: &Path) {
    for (part, reference) in blob_parts(message) {
        if blob_path(&reference, &part["mimeType"], directory).is_none() {
            *part = json!({"type":"text","text":UNAVAILABLE});
        }
    }
}

/// The base64 bytes of one referenced image, or None when it is missing or does not match its hash.
pub(super) fn load(reference: &str, mime: &str, directory: &Path) -> Option<String> {
    let mut message = json!({"content":[{"type":"image","mimeType":mime,"data":reference}]});
    restore(&mut message, directory);
    message["content"][0]["data"].as_str().filter(|_| message["content"][0]["type"] == "image").map(str::to_owned)
}
