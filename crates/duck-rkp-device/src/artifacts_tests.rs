use std::fs;

use duck_core::AppPaths;
use p256::SecretKey as P256SecretKey;
use pkcs8::DecodePrivateKey as _;
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};

use super::{
    ArtifactPaths, Inputs, MAX_CHAIN_CERTIFICATES, ParsedCertificate, device_id,
    ensure_chain_is_linked, ensure_chain_matches_key, parse_der_cert_chain, pem_wrap, write,
};

/// One generated P-256 key together with its self-signed certificate.
fn self_signed() -> (P256SecretKey, Vec<u8>) {
    let pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let secret = P256SecretKey::from_pkcs8_der(pair.serialized_der()).unwrap();
    let certificate = CertificateParams::default().self_signed(&pair).unwrap();
    (secret, certificate.der().to_vec())
}

/// The first base64 line of a certificate PEM block. Every keybox line is indented,
/// so an exact block lookup would not match; the first line is unique and enough.
fn pem_first_line(der: &[u8]) -> String {
    super::pem_wrap("CERTIFICATE", der)
        .lines()
        .nth(1)
        .expect("a certificate PEM block has a body")
        .to_owned()
}

/// Parameters with a real subject name. rcgen would otherwise give every certificate
/// the same common name, which makes an issuer and its subject indistinguishable.
fn params(common_name: &str) -> CertificateParams {
    let mut params = CertificateParams::default();
    let mut name = rcgen::DistinguishedName::new();
    name.push(rcgen::DnType::CommonName, common_name);
    params.distinguished_name = name;
    params
}

/// A root plus a leaf it issued, as the RKP server returns them.
fn two_level_chain() -> (P256SecretKey, Vec<u8>, Vec<u8>) {
    use rcgen::CertifiedIssuer;

    let root = CertifiedIssuer::self_signed(
        params("duck-test-root"),
        KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap(),
    )
    .unwrap();

    let leaf_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let secret = P256SecretKey::from_pkcs8_der(leaf_key.serialized_der()).unwrap();
    let leaf = params("duck-test-leaf")
        .signed_by(&leaf_key, &root)
        .unwrap();

    (secret, leaf.der().to_vec(), root.der().to_vec())
}

#[test]
fn parse_expands_the_p256_subject_public_key() {
    let (secret, der) = self_signed();
    let parsed = parse_der_cert_chain(&der).unwrap();

    assert_eq!(parsed.len(), 1);
    assert_eq!(
        parsed[0].public_key.as_deref(),
        Some(secret.public_key().to_sec1_bytes().as_ref())
    );
    assert!(!parsed[0].subject_der.is_empty());
}

#[test]
fn parse_keeps_every_certificate_of_a_concatenated_chain() {
    let (_, leaf) = self_signed();
    let (_, issuer) = self_signed();
    let mut stream = leaf.clone();
    stream.extend_from_slice(&issuer);

    let parsed = parse_der_cert_chain(&stream).unwrap();
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].der, leaf);
    assert_eq!(parsed[1].der, issuer);
}

#[test]
fn parse_rejects_empty_truncated_and_malformed_chains() {
    assert!(parse_der_cert_chain(&[]).is_err());

    let (_, der) = self_signed();
    let mut truncated = der.clone();
    truncated.pop();
    assert!(parse_der_cert_chain(&truncated).is_err());

    let mut extended = der;
    extended.extend_from_slice(&[0x00, 0x01]);
    assert!(parse_der_cert_chain(&extended).is_err());
}

#[test]
fn parse_rejects_chains_longer_than_the_cap() {
    let (_, der) = self_signed();
    let mut repeated = Vec::new();
    for _ in 0..=MAX_CHAIN_CERTIFICATES {
        repeated.extend_from_slice(&der);
    }

    let error = parse_der_cert_chain(&repeated).unwrap_err();
    assert!(error.to_string().contains("more than"));
}

#[test]
fn chain_must_carry_the_generated_public_key() {
    let (secret, der) = self_signed();
    let chain = parse_der_cert_chain(&der).unwrap();
    ensure_chain_matches_key(&chain, &secret).unwrap();

    let (other, _) = self_signed();
    let error = ensure_chain_matches_key(&chain, &other).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "certificate_key_mismatch");
}

#[test]
fn a_missing_leaf_is_a_mismatch() {
    let (secret, _) = self_signed();
    let error = ensure_chain_matches_key(&[], &secret).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "certificate_key_mismatch");
}

#[test]
fn write_lays_out_every_artifact_and_rejects_a_mismatched_chain() {
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root.path(), root.path());
    let (secret, der) = self_signed();

    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 32],
            cert_chain_der: &der,
            manufacturer: "Google",
        },
    )
    .unwrap();

    assert!(artifacts.device_id.starts_with("Google-"));
    assert!(artifacts.keybox_xml.contains("<AndroidAttestation>"));
    for path in [
        &artifacts.paths.keybox_path,
        &artifacts.paths.csr_path,
        &artifacts.paths.cert_chain_path,
        &artifacts.paths.private_key_path,
    ] {
        assert!(fs::metadata(path).unwrap().is_file(), "{path} must exist");
    }

    let (other, _) = self_signed();
    let error = write(
        &paths,
        Inputs {
            secret_key: &other,
            csr: &[0xAB; 32],
            cert_chain_der: &der,
            manufacturer: "Google",
        },
    )
    .unwrap_err();
    assert_eq!(crate::error::code_of(&error), "certificate_key_mismatch");
}

#[test]
fn a_two_level_chain_is_linked_and_written_leaf_first() {
    let (secret, leaf, root) = two_level_chain();
    let mut stream = leaf.clone();
    stream.extend_from_slice(&root);

    let chain = parse_der_cert_chain(&stream).unwrap();
    assert_eq!(chain.len(), 2);
    ensure_chain_is_linked(&chain).unwrap();
    // The summary the WebUI shows is real X.509 text, not a lossy byte scan.
    assert_eq!(chain[0].subject_label, "CN=duck-test-leaf");
    assert_eq!(chain[1].subject_label, "CN=duck-test-root");
    assert_eq!(chain[0].issuer_label, "CN=duck-test-root");

    let paths_root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(paths_root.path(), paths_root.path());
    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 32],
            cert_chain_der: &stream,
            manufacturer: "Google",
        },
    )
    .unwrap();

    // Tricky Store and the other daemons read the keybox chain leaf first. Every PEM
    // line is indented, so compare the encoded bodies instead of whole blocks.
    let xml = &artifacts.keybox_xml;
    let leaf_at = xml
        .find(&pem_first_line(&leaf))
        .expect("the leaf must be in the keybox");
    let root_at = xml
        .find(&pem_first_line(&root))
        .expect("the root must be in the keybox");
    assert!(
        leaf_at < root_at,
        "the leaf must come first: {leaf_at} < {root_at}"
    );
}

/// A certificate as the chain walk sees it: only the name fields matter.
fn named(der: u8, subject: &str, issuer: &str) -> ParsedCertificate {
    ParsedCertificate {
        der: vec![der],
        subject_der: subject.as_bytes().to_vec(),
        issuer_der: issuer.as_bytes().to_vec(),
        subject_label: subject.to_owned(),
        issuer_label: issuer.to_owned(),
        public_key: None,
    }
}

/// The keybox we write must survive the same validation that gates installing one on a
/// device; otherwise the tool would hand the user a file the manager rejects.
/// A server that lists the root first must still produce a leaf-first keybox *and* a
/// summary in the same order; otherwise the report would describe a different chain.
#[test]
fn the_summary_and_the_keybox_agree_on_order() {
    let (secret, leaf, root) = two_level_chain();
    let mut stream = root.clone();
    stream.extend_from_slice(&leaf);

    let root_dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root_dir.path(), root_dir.path());
    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 16],
            cert_chain_der: &stream,
            manufacturer: "Google",
        },
    )
    .unwrap();

    let summary = super::ChainSummary::of(&artifacts.chain);
    assert_eq!(summary.subjects, ["CN=duck-test-leaf", "CN=duck-test-root"]);

    let leaf_at = artifacts
        .keybox_xml
        .find(&pem_first_line(&leaf))
        .expect("the leaf must be in the keybox");
    let root_at = artifacts
        .keybox_xml
        .find(&pem_first_line(&root))
        .expect("the root must be in the keybox");
    assert!(leaf_at < root_at, "the keybox must be leaf first too");
}

/// `Inputs` is the seam both the artifacts writer and the service use.
#[test]
fn artifact_inputs_bind_a_key_to_a_chain() {
    let (secret, leaf, root) = two_level_chain();
    let mut stream = leaf.clone();
    stream.extend_from_slice(&root);

    let root_dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root_dir.path(), root_dir.path());
    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 16],
            cert_chain_der: &stream,
            manufacturer: "Google",
        },
    )
    .unwrap();

    assert_eq!(artifacts.chain.len(), 2);
    let summary = super::ChainSummary::of(&artifacts.chain);
    assert_eq!(summary.certificates, 2);
    assert_eq!(summary.subjects[0], "CN=duck-test-leaf");
}

/// Parsed certificates are comparable by their key material, which is what the writer and
/// the report both rely on.
#[test]
fn parsed_certificates_expose_their_public_key() {
    let (secret, leaf, _) = two_level_chain();
    let chain = parse_der_cert_chain(&leaf).unwrap();

    assert_eq!(
        chain[0].public_key.as_deref(),
        Some(secret.public_key().to_sec1_bytes().as_ref())
    );
}

#[test]
fn the_written_keybox_passes_the_daemon_validator() {
    let (secret, leaf, root) = two_level_chain();
    let mut stream = leaf.clone();
    stream.extend_from_slice(&root);

    let root_dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root_dir.path(), root_dir.path());
    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 32],
            cert_chain_der: &stream,
            manufacturer: "Google",
        },
    )
    .unwrap();

    let summary = duck_tricky_store::keybox::validate::validate(&artifacts.keybox_xml).unwrap();
    assert!(summary.has_ecdsa);
    assert!(summary.counts_declared_correctly);
    assert_eq!(summary.chain_lengths, vec![2]);
    // Cleaning must not take anything away that the daemons need.
    let cleaned = duck_tricky_store::keybox::validate::clean(&artifacts.keybox_xml).unwrap();
    assert!(cleaned.contains("<CertificateChain>"));
    duck_tricky_store::keybox::validate::validate(&cleaned).unwrap();
}

#[test]
fn a_rejected_chain_writes_nothing() {
    // The output directory may be created, but a failed run must not leave a keybox, a
    // private key or a CSR behind.
    let (secret, leaf, _) = two_level_chain();
    let root_dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root_dir.path(), root_dir.path());

    let error = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[0xAB; 32],
            cert_chain_der: &leaf,
            manufacturer: "Google",
        },
    )
    .unwrap_err();
    assert_eq!(crate::error::code_of(&error), "invalid_device_csr");

    let outputs = std::fs::read_dir(&paths.outputs_dir)
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(outputs, 0, "a rejected chain must not leave output files");
}

#[test]
fn a_certificate_outside_the_leaf_to_root_path_is_rejected() {
    // The leaf reaches "root", so "stray" is neither on the path nor the root the walk
    // ended at. Keeping it would leave a keybox chain the device cannot verify.
    let chain = vec![
        named(1, "leaf", "root"),
        named(2, "root", "root"),
        named(3, "stray", "stray"),
    ];

    let error = ensure_chain_is_linked(&chain).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "invalid_device_csr");
    assert!(error.to_string().contains("outside the leaf-to-root path"));
}

#[test]
fn an_issuer_cycle_is_rejected() {
    // Neither entry can be the leaf: each is issued by the other, so the chain has no root.
    let chain = vec![named(1, "a", "b"), named(2, "b", "a")];

    let error = ensure_chain_is_linked(&chain).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "certificate_key_mismatch");
}

#[test]
fn a_self_issued_certificate_cannot_masquerade_as_the_root() {
    // Two self-issued certificates; only the one the walk ends at is the root.
    let chain = vec![
        named(1, "leaf", "root"),
        named(2, "root", "root-a"),
        named(3, "impostor", "impostor"),
    ];

    let error = ensure_chain_is_linked(&chain).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "invalid_device_csr");
}

#[test]
fn a_chain_without_its_issuer_is_rejected() {
    let (_, leaf, _) = two_level_chain();
    let orphan = parse_der_cert_chain(&leaf).unwrap();

    let error = ensure_chain_is_linked(&orphan).unwrap_err();
    assert_eq!(crate::error::code_of(&error), "invalid_device_csr");
}

#[test]
fn a_leaf_first_chain_is_not_a_root_detection_failure() {
    // The same two certificates in the other order must still be accepted: the walk
    // starts at the leaf, not at the first array entry.
    let (secret, leaf, root) = two_level_chain();
    let mut stream = root.clone();
    stream.extend_from_slice(&leaf);

    let chain = parse_der_cert_chain(&stream).unwrap();
    ensure_chain_is_linked(&chain).unwrap();
    ensure_chain_matches_key(&chain, &secret).unwrap();
}

#[test]
fn run_directories_are_unique_per_run() {
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root.path(), root.path());

    let first = super::unique_run_dir(&paths).unwrap();
    let second = super::unique_run_dir(&paths).unwrap();

    assert!(first.path().is_dir());
    assert!(second.path().is_dir());
    assert_ne!(first.path(), second.path());
}

#[test]
fn concurrent_runs_reserve_different_directories() {
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root.path(), root.path());
    let barrier = std::sync::Barrier::new(16);
    let directories = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..16)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    super::unique_run_dir(&paths).unwrap()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    let mut names: Vec<_> = directories.iter().map(|dir| dir.path()).collect();
    names.sort();
    names.dedup();
    assert_eq!(names.len(), directories.len());
}

#[cfg(unix)]
#[test]
fn secret_outputs_are_private_and_replace_symlinks() {
    use std::os::unix::fs::{PermissionsExt as _, symlink};

    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root.path(), root.path());
    let (secret, der) = self_signed();
    let artifacts = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[],
            cert_chain_der: &der,
            manufacturer: "QTI",
        },
    )
    .unwrap();
    for path in [
        &artifacts.paths.private_key_path,
        &artifacts.paths.keybox_path,
    ] {
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert_eq!(
        fs::metadata(&artifacts.paths.run_dir)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );

    let destination = root.path().join("export.xml");
    fs::write(&destination, "old").unwrap();
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o644)).unwrap();
    super::write_keybox(&destination, &artifacts.keybox_xml).unwrap();
    assert_eq!(
        fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
        0o600
    );

    let target = root.path().join("untouched.xml");
    fs::write(&target, "original").unwrap();
    fs::remove_file(&destination).unwrap();
    symlink(&target, &destination).unwrap();
    super::write_keybox(&destination, &artifacts.keybox_xml).unwrap();
    assert!(
        !fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read_to_string(target).unwrap(), "original");
    assert_eq!(
        fs::read_to_string(destination).unwrap(),
        artifacts.keybox_xml
    );
}

#[test]
fn device_ids_are_unique_and_use_the_manufacturer() {
    let first = device_id("Google").unwrap();
    let second = device_id("Google").unwrap();
    assert!(first.starts_with("Google-"));
    assert_ne!(first, second);
    assert!(device_id("   ").unwrap().starts_with("generic-"));
}

#[test]
fn pem_wrapping_uses_the_requested_label() {
    let pem = pem_wrap("EC PRIVATE KEY", &[0x30, 0x00]);
    assert!(pem.starts_with("-----BEGIN EC PRIVATE KEY-----\n"));
    assert!(pem.trim_end().ends_with("-----END EC PRIVATE KEY-----"));
}

/// The reported paths are stable strings a caller can hand back to the user.
#[test]
fn artifact_paths_stay_under_the_outputs_directory() {
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_root(root.path(), root.path());
    let (secret, der) = self_signed();

    let ArtifactPaths {
        run_dir,
        keybox_path,
        ..
    } = write(
        &paths,
        Inputs {
            secret_key: &secret,
            csr: &[],
            cert_chain_der: &der,
            manufacturer: "Google",
        },
    )
    .unwrap()
    .paths;

    assert!(run_dir.starts_with(&paths.outputs_dir.display().to_string()));
    assert!(keybox_path.ends_with("keybox.xml"));
}
