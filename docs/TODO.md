核心
- [ ] 构建插件系统（为外部提供 event, hook, tool 统一的注册能力，暂时不做 UI 的）
- [ ] 新增 subagent （基于插件系统）
- [ ] 新增 skills 功能 （基于插件系统）
- [ ] 新增 context compact 功能 （在 core/harness 加）

extra:
- [ ] 统一 core 包的 error 处理（现在比较混乱），如果可以把 coding-agent 的一起统一
- [ ] 调整 system prompt
- [ ] 增加 logging 功能，使得系统每一次 llm 调用都可以追踪审计（session 级别需要记录每一次的消息，并且标注类型，后台调用需要另外记录，比如 subagent 的运行，session-title 自动生成，compact 的 llm 调用等）
- [ ] 增加并发支持（session 并发，background 后台运行）
- [ ] 新增 memory 功能
