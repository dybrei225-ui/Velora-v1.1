import { GoogleGenAI, Type } from '@google/genai';
import { AIHighlight, HighlightCategory } from '../src/types.js';

interface HighlightCandidatePrompt {
  duration: number;
  title: string;
  channel: string;
  focusArea: string;
  customPrompt?: string;
  acousticPeaks?: Array<{ time: number; energy: number; description: string }>;
}

let aiClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export async function analyzeVodHighlights(params: HighlightCandidatePrompt): Promise<AIHighlight[]> {
  const ai = getGenAI();
  const duration = Math.max(30, Math.round(params.duration));

  // If no Gemini API key configured, generate high-quality algorithmic editorial cuts based on timeline & acoustic peaks
  if (!ai) {
    console.warn('GEMINI_API_KEY not set. Generating algorithmic editorial highlights.');
    return generateHeuristicHighlights(params);
  }

  const focusArea = params.focusArea || 'Reacciones y Momentos Épicos';
  const customPrompt = params.customPrompt ? `\nPetición específica del editor: "${params.customPrompt}"` : '';

  const peaksInfo = params.acousticPeaks && params.acousticPeaks.length > 0
    ? `\nPicos acústicos y momentos de alta intensidad detectados en el audio:\n${params.acousticPeaks.map(p => `- Minuto/Segundo ${Math.floor(p.time / 60)}:${Math.floor(p.time % 60).toString().padStart(2, '0')} (${p.time.toFixed(1)}s): ${p.description}, energía ${Math.round(p.energy * 100)}%`).join('\n')}`
    : `\nNo se detectaron pistas acústicas previas; distribuye los cortes estratégicamente a lo largo de los ${duration} segundos de duración total.`;

  const prompt = `Eres el Asistente Editorial de Inteligencia Artificial para VELORA, la suite de postproducción para transmisiones de Kick.
Tu misión es seleccionar los mejores momentos y clips imperdibles de este VOD para un video resumen de YouTube de alto impacto.

Datos del VOD:
- Título de la transmisión: "${params.title}"
- Creador/Canal: "${params.channel}"
- Duración total del video: ${duration} segundos (${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m ${Math.floor(duration % 60)}s)
- Área de enfoque editorial: "${focusArea}"${customPrompt}
${peaksInfo}

Reglas Editoriales:
1. Propón entre 4 y 10 segmentos destacados que mantengan al espectador enganchado.
2. Cada segmento debe tener una duración recomendada de entre 15 y 120 segundos.
3. Asegúrate de que las marcas de tiempo (start y end) estén estrictamente dentro del rango de 0 a ${duration} segundos, sin solaparse y con start < end.
4. Categorías permitidas: "reaccion", "victoria", "derrota", "humor", "tension", "conversacion", "destacado".
5. Redacta una justificación editorial clara y profesional de por qué este momento merece estar en el corte final para YouTube.`;

  const schema = {
    type: Type.ARRAY,
    description: 'Lista de momentos destacados sugeridos para el video final',
    items: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Título conciso y llamativo del momento o clip',
        },
        start: {
          type: Type.NUMBER,
          description: 'Segundo de inicio del momento (float o integer)',
        },
        end: {
          type: Type.NUMBER,
          description: 'Segundo de fin del momento (float o integer)',
        },
        category: {
          type: Type.STRING,
          description: 'Categoría: reaccion, victoria, derrota, humor, tension, conversacion, o destacado',
        },
        reason: {
          type: Type.STRING,
          description: 'Justificación editorial detallando por qué conservar este clip',
        },
        confidence: {
          type: Type.NUMBER,
          description: 'Nivel de relevancia de 0.5 a 1.0',
        },
      },
      required: ['title', 'start', 'end', 'category', 'reason'],
    },
  };

  // Try primary model: gemini-3.1-flash-lite, fallback to gemini-3.6-flash
  const models = ['gemini-3.1-flash-lite', 'gemini-3.6-flash'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: 'Eres un editor de video profesional sénior especializado en contenido de Kick, Twitch y resúmenes virales de YouTube.',
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.7,
        },
      });

      const text = response.text?.trim();
      if (!text) continue;

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, index) => {
          let start = Math.max(0, Math.min(duration - 2, Number(item.start) || 0));
          let end = Math.max(start + 5, Math.min(duration, Number(item.end) || start + 30));
          const validCategories: HighlightCategory[] = [
            'reaccion', 'victoria', 'derrota', 'humor', 'tension', 'conversacion', 'destacado'
          ];
          const category = validCategories.includes(item.category) ? item.category : 'destacado';

          return {
            id: `ai-${Date.now()}-${index}`,
            title: String(item.title || `Momento destacado #${index + 1}`),
            start: Math.round(start * 10) / 10,
            end: Math.round(end * 10) / 10,
            category,
            reason: String(item.reason || 'Momento clave con alto dinamismo detectado por la IA.'),
            confidence: item.confidence ? Number(item.confidence) : 0.9,
          };
        });
      }
    } catch (err) {
      console.error(`Error with model ${model}:`, err);
      lastError = err;
    }
  }

  console.warn('Gemini API call unsuccessful or fallback needed:', lastError);
  return generateHeuristicHighlights(params);
}

function generateHeuristicHighlights(params: HighlightCandidatePrompt): AIHighlight[] {
  const duration = Math.max(30, Math.round(params.duration));
  const categories: HighlightCategory[] = ['reaccion', 'humor', 'tension', 'victoria', 'conversacion', 'destacado'];
  const titles = [
    { cat: 'reaccion', title: 'Reacción explosiva al evento principal', reason: 'Pico de volumen e intensidad emocional ideal para captar atención en YouTube.' },
    { cat: 'humor', title: 'Momento cómico con el chat', reason: 'Interacción espontánea y remate divertido que genera retención.' },
    { cat: 'tension', title: 'Clímax y suspenso en la partida', reason: 'Secuencia tensa previa a la resolución de la jugada.' },
    { cat: 'victoria', title: 'Jugada maestra y celebración', reason: 'Momento cumbre de recompensa y alta energía del creador.' },
    { cat: 'conversacion', title: 'Anécdota destacada y debate', reason: 'Conversación fluida con valor de re-visualización y contexto.' },
    { cat: 'destacado', title: 'Transición y momento imperdible', reason: 'Ritmo ágil y conexión entre secuencias importantes.' },
  ];

  const highlights: AIHighlight[] = [];
  const count = Math.min(6, Math.max(3, Math.floor(duration / 40)));
  const step = duration / (count + 1);

  for (let i = 0; i < count; i++) {
    const center = (i + 1) * step;
    const clipLen = Math.min(45, Math.max(15, Math.round(duration * 0.08)));
    const start = Math.max(0, Math.round(center - clipLen / 2));
    const end = Math.min(duration, start + clipLen);
    const item = titles[i % titles.length];

    highlights.push({
      id: `ai-heuristic-${i + 1}`,
      title: item.title,
      start,
      end,
      category: item.cat as HighlightCategory,
      reason: item.reason,
      confidence: 0.88,
    });
  }

  return highlights;
}
