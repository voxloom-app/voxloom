//! Dedicated file-Keychain item. Never update, delete, unlock, or change ACLs.
use super::encrypted::KeyOps;
use core_foundation::data::CFData;
use security_framework::{
    item::{
        ItemAddOptions, ItemAddValue, ItemClass, ItemSearchOptions, Limit, Location, SearchResult,
    },
    os::macos::keychain::SecKeychain,
};

const SERVICE: &str = "com.voxloom.prototype.history";
const ACCOUNT: &str = "encryption-key";

pub(super) struct SystemKeys {
    // Resolve the default once per transaction so both the restricted search
    // and add use the very same file Keychain, even if the default changes.
    default: SecKeychain,
}
impl SystemKeys {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            default: SecKeychain::default().map_err(|e| keychain_error(e.code()))?,
        })
    }
}
fn add_options(key: &[u8]) -> ItemAddOptions {
    let mut options = ItemAddOptions::new(ItemAddValue::Data {
        class: ItemClass::generic_password(),
        data: CFData::from_buffer(key),
    });
    options
        .set_service(SERVICE)
        .set_account_name(ACCOUNT)
        .set_location(Location::DefaultFileKeychain);
    // Omit access/synchronization/data-protection/access-group overrides:
    // ordinary file-Keychain caller-default ACL, not an allow-all ACL.
    options
}
impl KeyOps for SystemKeys {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        let result = ItemSearchOptions::new()
            .keychains(std::slice::from_ref(&self.default))
            .class(ItemClass::generic_password())
            .service(SERVICE)
            .account(ACCOUNT)
            .limit(Limit::Max(2))
            .load_data(true)
            .search();
        match result {
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound only
            Err(e) => Err(keychain_error(e.code())),
            Ok(mut items) if items.len() == 1 => match items.pop().unwrap() {
                SearchResult::Data(data) => Ok(Some(data)),
                _ => Err("History Keychain item is invalid; files preserved".into()),
            },
            Ok(_) => Err("History Keychain item is ambiguous or invalid; files preserved".into()),
        }
    }
    fn add(&self, key: &[u8]) -> Result<(), String> {
        let mut options = add_options(key);
        options.set_location(Location::FileKeychain(self.default.clone()));
        // ItemAddOptions::add is SecItemAdd, NOT the password setter's upsert.
        match options.add() {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25299 => Ok(()), // duplicate: read winner
            Err(e) => Err(keychain_error(e.code())),
        }
    }
}
fn keychain_error(code: i32) -> String {
    match code {
        -128 | -25293 => "History Keychain access denied or cancelled; files preserved",
        -25308 => "History Keychain is locked or interaction is unavailable; files preserved",
        _ => "History Keychain is unavailable; files preserved",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provisioning_options_are_dedicated_default_file_keychain_without_shared_access() {
        // Building options is pure; no Security operation or keychain handle.
        let options = add_options(&[7; 32]);
        assert_eq!(options.service.unwrap().to_string(), SERVICE);
        assert_eq!(options.account_name.unwrap().to_string(), ACCOUNT);
        assert!(matches!(
            options.location,
            Some(Location::DefaultFileKeychain)
        ));
        assert!(options.access_group.is_none());
        assert!(options.comment.is_none());
    }
    #[test]
    fn keychain_errors_are_fixed_and_do_not_expose_key_material() {
        assert!(keychain_error(-128).contains("denied"));
        assert!(keychain_error(-25293).contains("denied"));
        assert!(keychain_error(-25308).contains("locked"));
        assert!(keychain_error(-25291).contains("unavailable"));
    }
}
