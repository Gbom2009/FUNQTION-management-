// Funqtion desktop / mobile shell. The whole suite is the web app in ../dist;
// this shell only hosts it in a native window so it can ship as a Windows
// .exe today and as an iPhone/iPad app later (`tauri ios build`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // File access for the Library (app 7): scan music folders and USB
        // drives, write tags, Serato crates and Rekordbox XML.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Funqtion");
}
