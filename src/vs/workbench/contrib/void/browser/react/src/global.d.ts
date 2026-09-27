// Type declaration for PNG image imports (bundled as base64 data URIs by esbuild)
declare module '*.png' {
	const dataUri: string;
	export default dataUri;
}
