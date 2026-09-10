# Loophole Codebase Guide

This document provides a technical overview of the Loophole codebase, its architecture, and key components.

## Overview

Loophole is built on top of the Void editor, which itself is a fork of Visual Studio Code. The codebase maintains the core VS Code architecture while adding AI-specific features and integrations.

## Project Structure

### Core Directories

- `src/vs/` - Main VS Code source code
  - `base/` - Base utilities and common code
  - `platform/` - Platform-specific implementations
  - `workbench/` - Workbench UI and functionality
  - `editor/` - Editor core functionality
  
- `extensions/` - Built-in extensions
  - Contains language features, themes, and other bundled extensions
  
- `build/` - Build scripts and configuration
  - Contains scripts for building, packaging, and distribution

- `resources/` - Static resources (icons, images, etc.)

### AI-Specific Components

Loophole adds AI integration layers on top of the VS Code architecture:

- **AI Chat Sidebar**: Integrated into the workbench as a sidebar view
- **Context Awareness Engine**: Analyzes code structure and relationships
- **Provider Interface**: Abstraction layer for connecting to various AI providers
- **Privacy Layer**: Ensures direct communication between client and AI providers

## Key Technologies

- **Electron**: Desktop application framework
- **TypeScript**: Primary language for the codebase
- **React**: UI components (built via `npm run buildreact`)
- **Node.js**: Backend services and build tools

## Build System

The project uses a custom build system based on npm scripts:

1. `npm install` - Install dependencies
2. `npm run buildreact` - Build React UI components
3. `npm run watch` - Watch mode for development
4. `npm run electron` - Run the Electron application

## Architecture Highlights

### Extension System

Loophole maintains VS Code's extension system while adding AI-specific APIs for extensions to leverage AI capabilities.

### Workbench Integration

AI features are integrated as native workbench components:
- Sidebar panels for AI chat
- Status bar indicators for AI status
- Context menus for AI-powered actions

### Provider Abstraction

The AI provider system allows plugging in different AI services through a unified interface, making it easy to add new providers or switch between them.

## Development Workflow

1. Make changes to source files
2. Run `npm run buildreact` if modifying React components
3. Run `npm run watch` to compile TypeScript in watch mode
4. Run `npm run electron` in a separate terminal to test changes

## Important Notes

- The codebase is large and complex. Start with specific areas rather than trying to understand everything at once.
- Many VS Code patterns and conventions are still applicable.
- AI-specific code is typically marked with comments or located in dedicated modules.
- Privacy is a core principle - AI requests bypass intermediate servers.

## Further Reading

- VS Code architecture documentation (applicable to most of the codebase)
- TypeScript documentation for type system understanding
- Electron documentation for desktop app specifics
