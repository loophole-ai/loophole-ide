/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { ExpertCanvas } from './ExpertCanvas.js'
import { ExpertCanvasPage } from './ExpertCanvasPage.js'

export const mountExpertCanvas = mountFnGenerator(ExpertCanvas)
export const mountExpertCanvasPage = mountFnGenerator(ExpertCanvasPage)
