# 控制面授权数据丢失后重新初始化并配对

公网控制面的授权数据库发生不可恢复的数据丢失时，Cyrene 不从旧应用备份直接恢复 Device Credential、撤销状态或 Owner Recovery Key，因为旧快照可能让已撤销设备重新有效。所有现有 token、进行中的 Voice Call 和旧 Owner Recovery Key 都因验证记录消失而失效，Owner 使用新的 Deployment Bootstrap Code 进行 Authorization Rebootstrap，生成新的恢复密钥，并让所有设备重新配对；重建后最多重新授权 3 台桌面和 5 台手机，并轮换 LiveKit API Secret。可以依赖云厂商自身高可用与短期灾难恢复，但任何会回退授权事实的恢复都必须按全量失效处理；审计丢失应披露，不能以复活旧授权为代价保留。此流程不同于 ADR-0029：只要原授权验证记录仍在，Owner Recovery Key 可以恢复 Owner；一旦该记录丢失，恢复密钥不能成为绕过全量失效的第二授权源。
