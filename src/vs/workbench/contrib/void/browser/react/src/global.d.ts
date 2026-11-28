/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Type declaration for PNG image imports (bundled as base64 data URIs by esbuild)
declare module '*.png' {
	const dataUri: string;
	export default dataUri;
}
