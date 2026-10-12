# Kea

Kea is a coding-agent application built to study and implement a small, explicit agent kernel and
the product architecture around it.

## Language

**Session**:
An Agent conversation, including its history and selected model. A new empty Session becomes
durable with its first Prompt.
_Avoid_: AgentSession, conversation runtime

**AgentHarness**:
The promptable Agent execution entity bound to one Session.
_Avoid_: Agent, AgentSessionRuntime

**Project**:
A canonical project directory and the project-scoped Sessions, configuration, and decisions that
belong to it.
_Avoid_: Workspace, repository, ProjectRuntime

**ApplicationRuntime**:
The state of one running Kea application, including which AgentHarness is currently selected.
_Avoid_: ApplicationController, AgentClient, global Project

**UserInteraction**:
The UI-independent boundary through which Kea asks a user to select, confirm, or provide input.
_Avoid_: InteractionService, UIContext, ApplicationContext
