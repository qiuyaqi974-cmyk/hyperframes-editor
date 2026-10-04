export interface TTSConfig {
  voiceName: string;
  speed: number;
  volume: number;
  pitch: number;
}

export interface TTSResult {
  src: string;
  duration?: number;
}

export interface TTSProvider {
  synthesize(text: string, config: TTSConfig): Promise<TTSResult>;
}
