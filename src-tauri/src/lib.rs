// Funqtion desktop / mobile shell. The whole suite is the web app in ../dist;
// this shell only hosts it in a native window so it can ship as a Windows
// .exe today and as an iPhone/iPad app later (`tauri ios build`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Funqtion");
}
