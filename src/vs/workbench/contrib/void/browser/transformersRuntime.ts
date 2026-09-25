/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Keep the Transformers.js browser build behind a relative lazy boundary. The
// renderer must not contain a bare import('@huggingface/transformers') because
// Electron's browser module loader cannot resolve npm package specifiers.
import * as transformers from '@huggingface/transformers';

export { transformers };
