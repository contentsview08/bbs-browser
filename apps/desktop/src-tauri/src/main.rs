// リリースビルドで Windows のコンソール窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bbs_browser_lib::run()
}
