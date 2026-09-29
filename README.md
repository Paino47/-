# SillyTavern Music Widget v0.1.0

一个独立的 SillyTavern 音乐小组件：

- 全局歌单 / 当前角色歌单
- 歌曲名 + 直接音频 URL + 可选封面 URL
- 播放、暂停、上一首、下一首、进度、音量
- 角色切换时自动切换角色歌单
- 悬浮按钮，不常驻占用输入区
- 插件内部主题：默认 / 古风 / 蓝黑 / 樱花
- PC + 移动端基础适配

## 安装
将本文件夹作为 SillyTavern extension 安装。插件根目录需要直接包含 `manifest.json`、`index.js`、`style.css`。

## 注意
音频 URL 需要是浏览器能够直接读取的音频资源。普通网页 URL、需要登录的资源或禁止跨域访问的资源可能无法播放。
