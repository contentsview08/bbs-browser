#[path = "src/oauth_env.rs"]
#[allow(dead_code)]
mod oauth_env;

fn main() {
    // Google の同期のクライアントは、ビルドのときの環境変数かファイルから入れる(値をリポジトリに置かない)
    for k in [oauth_env::ID_KEY, oauth_env::SECRET_KEY, oauth_env::FILE_KEY] {
        println!("cargo:rerun-if-env-changed={k}");
    }
    let env = |k: &str| std::env::var(k).ok();
    if let Some(path) = env(oauth_env::FILE_KEY).filter(|p| !p.trim().is_empty()) {
        println!("cargo:rerun-if-changed={}", path.trim());
    }
    match oauth_env::resolve(env, |p| std::fs::read_to_string(p).ok()) {
        Some((id, secret)) => {
            println!("cargo:rustc-env={}={id}", oauth_env::ID_KEY);
            println!("cargo:rustc-env={}={secret}", oauth_env::SECRET_KEY);
        }
        None if env(oauth_env::FILE_KEY).is_some() => println!("cargo:warning=OBB_GOOGLE_OAUTH_FILE から Google のクライアントを読めませんでした。Google の同期のないビルドになります"),
        None => {}
    }
    tauri_build::build()
}
