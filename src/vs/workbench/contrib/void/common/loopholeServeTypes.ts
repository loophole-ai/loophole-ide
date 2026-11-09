/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface LoopholeServeConnectParams {
	// override the bundled binary path; undefined = bundled <app>/resources/app/bin/loophole[.exe], then $PATH
	binaryPath?: string;
	// workspace to run the server in (cwd for sessions); undefined = first workspace folder
	workspacePath?: string;
	// extra env to pass to the server process
	env?: { [key: string]: string | undefined };
}

export interface LoopholeServeStatus {
	status: 'disconnected' | 'starting' | 'connected' | 'error';
	port?: number;
	error?: string;
	// which binary is (or would be) used
	binaryPath?: string;
	pid?: number;
}
