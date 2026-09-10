import { ServicesAccessor } from '../../../../../../editor/browser/editorExtensions.js';

export declare const mountTokenUsageDialog: (
    rootElement: HTMLElement,
    accessor: ServicesAccessor,
    props?: any
) => { rerender: (props?: any) => void; dispose: () => void };
