# Contributing to WS-Kit

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Bun**: Install from [bun.sh](https://bun.sh)

## Quick Start

1. **Fork and clone**:

   ```bash
   git clone https://github.com/your-username/ws-kit.git
   cd ws-kit
   ```

2. **Install dependencies**:

   ```bash
   bun install
   ```

3. **Run tests**:

   ```bash
   bun test
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Write your code** following existing patterns
3. **Add tests** for new functionality
4. **Run checks** (before committing):

   ```bash
   bun run typecheck   # Type checking
   bun run lint:fix    # Fix linting issues
   bun run format      # Auto-format code (optional - runs automatically on commit)
   bun test            # Run tests
   ```

   Pre-commit hooks will automatically format code and run type checks, but it's good practice to run these locally first.

### Code Standards

- **TypeScript**: Strict mode with full type safety
- **Formatting**: Prettier (auto-runs on commit via lint-staged)
- **Linting**: ESLint with unused directive checks
- **Exports**: Named exports, tree-shakable modules
- **Tests**: Cover new functionality and edge cases

## Submitting Changes

1. **Commit your changes**:

   ```bash
   git add .
   git commit -m "Add your feature description"
   ```

   Pre-commit hooks will format code and run type checks.

2. **Push and create PR**:

   ```bash
   git push origin feature/your-feature-name
   ```

3. **PR checklist**:
   - [ ] Tests pass locally
   - [ ] Code is formatted (automatic via hooks)
   - [ ] TypeScript compiles without errors
   - [ ] New functionality has tests

## Project Structure

```
packages/
├── core/            # Core router implementation
├── zod/             # Zod validator adapter
├── valibot/         # Valibot validator adapter
├── bun/             # Bun platform adapter
├── cloudflare/      # Cloudflare DO platform adapter
├── redis/           # Redis pub/sub adapter
└── client/          # WebSocket client library
docs/
├── specs/           # Technical specifications
└── adr/             # Architectural Decision Records
tests/               # Cross-package integration & e2e tests
examples/            # Usage examples
```

## Types of Contributions

- **Bug fixes**: Include test case demonstrating the bug
- **New features**: Discuss approach first in an issue
- **Performance improvements**: Include benchmarks when relevant
- **Documentation**: Examples, edge cases, and troubleshooting
- **Tests**: Better coverage is always welcome

## Design Principles

Follow these key principles:

- **Prioritize optimal design over backwards compatibility**
- **Keep it simple** - avoid over-engineering
- **Design APIs that are predictable, composable, and hard to misuse**
- **Pay attention to developer experience**
- **Pay attention to performance**

## Getting Help

- **Questions**: Open a [discussion](https://github.com/kriasoft/ws-kit/discussions)
- **Bugs**: Check [existing issues](https://github.com/kriasoft/ws-kit/issues) first
- **Documentation**: See [docs site](https://kriasoft.com/ws-kit/)

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build something useful together.
