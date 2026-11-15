/**
 * Image processing stub interface (WASM photon disabled in pi-native).
 */

export interface PhotonImageType {
	get_width(): number;
	get_height(): number;
	get_raw_pixels(): Uint8Array;
	get_bytes(): Uint8Array;
	get_bytes_jpeg(quality: number): Uint8Array;
	free(): void;
}

export interface PhotonModule {
	PhotonImage: {
		new (pixels: Uint8Array, width: number, height: number): PhotonImageType;
		new_from_byteslice(bytes: Uint8Array): PhotonImageType;
	};
	SamplingFilter: {
		Lanczos3: number;
	};
	resize(image: PhotonImageType, width: number, height: number, filter: number): PhotonImageType;
	fliph(image: PhotonImageType): void;
	flipv(image: PhotonImageType): void;
}

export async function loadPhoton(): Promise<PhotonModule | null> {
	return null;
}
