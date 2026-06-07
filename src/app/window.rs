pub(super) fn asset_file_path() -> String {
    std::env::var("DRUSNIEL_EDITOR_ASSET_DIR").unwrap_or_else(|_| "assets".to_string())
}
