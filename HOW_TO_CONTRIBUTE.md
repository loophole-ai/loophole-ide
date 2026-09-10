# How to Contribute to Loophole

Thank you for your interest in contributing to Loophole! This document will guide you through the process.

## Getting Started

### Prerequisites

- Node.js version 22 or higher
- Python (required for some build tools)
- C++ build tools (required for native modules)
- Git

### Setting Up the Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/loophole-ai/loophole-ide.git
   cd loophole-ide
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build UI Components**
   ```bash
   npm run buildreact
   ```

4. **Run in Development Mode**
   ```bash
   # Terminal 1: Watch mode for TypeScript compilation
   npm run watch
   
   # Terminal 2: Run Electron
   npm run electron
   ```

## Contribution Guidelines

### Code Style

- Follow the existing TypeScript coding style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and modular

### Commit Messages

Use clear, descriptive commit messages:
- Use imperative mood ("Add feature" not "Added feature")
- Reference relevant issues if applicable
- Keep the first line under 50 characters
- Add detailed description in the body if needed

### Pull Request Process

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Write clean, well-documented code
   - Add tests if applicable
   - Update documentation if needed

3. **Test Your Changes**
   - Run the application and verify your changes work
   - Test edge cases
   - Ensure no regressions in existing functionality

4. **Submit a Pull Request**
   - Provide a clear description of your changes
   - Link to related issues
   - Request review from maintainers

## Areas for Contribution

### Bug Fixes

Help us fix bugs! Check the issues page for open bug reports.

### Feature Requests

Have an idea for improving Loophole? We'd love to hear it:
- Open an issue to discuss the feature first
- Get feedback from maintainers
- Implement the feature following the guidelines above

### Documentation

Improve documentation by:
- Fixing typos or unclear sections
- Adding examples
- Updating outdated information
- Translating documentation

### AI Provider Integrations

Help us add support for more AI providers:
- Implement the provider interface
- Add tests for the new provider
- Update documentation with provider-specific setup instructions

### UI/UX Improvements

Make Loophole better to use:
- Improve the chat interface
- Enhance context awareness visualizations
- Add helpful keyboard shortcuts
- Improve accessibility

## Testing

- Always test your changes before submitting
- If you add new functionality, consider adding tests
- Test on different platforms (Windows, macOS, Linux) if possible

## Questions?

- Open an issue for questions or discussions
- Check existing issues for similar questions
- Be patient - maintainers will respond as soon as possible

## License

By contributing to Loophole, you agree that your contributions will be licensed under the AGPL-3.0 license.

## Code of Conduct

Be respectful and inclusive. We welcome contributors from all backgrounds and experience levels.

Thank you for contributing to Loophole!
