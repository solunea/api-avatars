// Catalogue commun à l'éditeur et à api-avatars (copie synchronisée pour le déploiement).
export const GEMINI_TTS_MODELS = [
    {prefix: 'gemini', model: 'google/gemini-3.1-flash-tts', modelLabel: 'Gemini 3.1 Flash TTS'},
    {prefix: 'gemini-3.8', model: 'google/gemini-3.8-flash-tts', modelLabel: 'Gemini 3.8 Flash TTS'}
];
export const DEFAULT_GEMINI_VOICE_KEY = 'gemini-3.8:Kore';
export const GEMINI_VOICE_NAMES = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algenib', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Algieba',
    'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager',
    'Sulafat', 'Alnilam', 'Rasalgethi'
];
// Genre des échantillons Chirp 3 HD utilisés pour les aperçus de timbre.
// https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd#voice_options
export const GEMINI_VOICE_GENDERS = {
    Zephyr: 'female', Puck: 'male', Charon: 'male', Kore: 'female', Fenrir: 'male', Leda: 'female',
    Orus: 'male', Aoede: 'female', Callirrhoe: 'female', Autonoe: 'female', Enceladus: 'male',
    Iapetus: 'male', Umbriel: 'male', Algenib: 'male', Despina: 'female', Erinome: 'female',
    Laomedeia: 'female', Achernar: 'female', Algieba: 'male', Schedar: 'male', Gacrux: 'female',
    Pulcherrima: 'female', Achird: 'male', Zubenelgenubi: 'male', Vindemiatrix: 'female',
    Sadachbia: 'male', Sadaltager: 'male', Sulafat: 'female', Alnilam: 'male', Rasalgethi: 'male'
};

export const GEMINI_VOICES = GEMINI_TTS_MODELS.flatMap(({prefix, model, modelLabel}) =>
    GEMINI_VOICE_NAMES.map(name => ({
        key: `${prefix}:${name}`, name, language: 'en', engine: 'gemini', model, modelLabel,
        geminiVoice: name, gender: GEMINI_VOICE_GENDERS[name], deletable: false,
        previewUrl: `https://docs.cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-${name === 'Aoede' ? 'aoeda' : name.toLowerCase()}.wav`
    }))
);

export function getGeminiVoice(key) {
    return GEMINI_VOICES.find(voice => voice.key === key);
}
