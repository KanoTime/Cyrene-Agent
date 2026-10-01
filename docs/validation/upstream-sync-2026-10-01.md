# 2026-10-01 上游同步验证

上游：`Playa-Cyrene/Cyrene-Agent`，`c5226de9f75da8edaf25497046a484e5169dae29`。
公开仓库合并起点：`7d21223f0bc0a125a264fa5883b3c3ef831e5bdc`。
私有仓库合并起点：`0c04845194cb83cc0fcc3e2bf7c15a9c6eafa29b`。

角色包、角色独立记忆与会话、微信多账号及权限隔离、移动端加密语音和本地 ASR 已接入上游的新主进程与 React 设置界面。保留上游模型重试、通道调度、插件与视觉输入接口。私有部署配置只保留在私有仓库。

## 验证结果

- `npm run build`：通过（main、preload、CLI、renderer）。
- `npm run check:renderer`：通过。
- `npm run check:plugin-schema`：通过。
- 受影响的角色、微信、语音、远程访问、主进程和设置回归：751 项通过，0 项失败。
- 最后角色提示词、Moments 与工具权限检查：83 项通过，0 项失败；随后 `npm run build:main` 通过。
- 干净上游同机基准：83 项通过、20 项失败。失败涉及 macOS 临时路径、Windows 路径与截图辅助程序、文件监听、插件重载和 shell 输出测试；全量测试因此未全绿。

以上验证使用锁文件依赖。未打包或部署新 APK，未进行 Android / 公网 LiveKit 实机通话，也未生成 Windows 安装包。
