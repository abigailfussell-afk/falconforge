import { GoogleGenAI, Type } from "@google/genai";
import { Task, Flashcard } from "../types";

const apiKey = process.env.API_KEY || '';

// Safely initialize AI only if key exists, otherwise we handle errors gracefully in UI
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const generatePortfolioSummary = async (tasks: Task[]): Promise<string> => {
  if (!ai) throw new Error("API Key missing");

  const completedTasks = tasks.filter(t => t.status === 'Done');
  const taskSummary = completedTasks.map(t => 
    `- ${t.title} (${t.type}): ${t.description}. Tags: ${t.tags.join(', ')}`
  ).join('\n');

  const prompt = `
    You are an assistant for an FTC Robotics team. 
    Based on the following completed tasks for the season, write a professional, 
    bulleted Engineering Portfolio summary in Markdown format. 
    Highlight technical achievements, problem-solving, and team progression.
    
    Tasks:
    ${taskSummary}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });

  return response.text || "Could not generate summary.";
};

export const generateInterviewQuestions = async (contextText: string, studyGuide?: string): Promise<Flashcard[]> => {
  if (!ai) throw new Error("API Key missing");

  const prompt = `
    Create 5 potential judge interview questions and answers for an FTC Robotics team.
    Base the questions on the provided context about the team's season and robot.
    
    Context from Portfolio:
    ${contextText}

    Additional Study Guide Info:
    ${studyGuide || 'None provided.'}

    Return the response as a JSON object with a list of "question" and "answer" pairs.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
            questions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        answer: { type: Type.STRING }
                    }
                }
            }
        }
      }
    }
  });

  try {
    const json = JSON.parse(response.text || "{}");
    return json.questions || [];
  } catch (e) {
    console.error("Failed to parse AI response", e);
    return [];
  }
};

export const summarizeMeeting = async (notes: string): Promise<string> => {
    if (!ai) throw new Error("API Key missing");

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Summarize these robotics team meeting notes into concise minutes with action items:\n\n${notes}`
    });
    return response.text || "";
}
