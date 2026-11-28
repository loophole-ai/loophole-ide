/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { ExpertCanvas } from './ExpertCanvas.js'
import { ExpertCanvasPage } from './ExpertCanvasPage.js'

export const mountExpertCanvas = mountFnGenerator(ExpertCanvas)
export const mountExpertCanvasPage = mountFnGenerator(ExpertCanvasPage)
