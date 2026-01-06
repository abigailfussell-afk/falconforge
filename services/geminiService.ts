import { GoogleGenAI } from "@google/genai";
import { Task, Flashcard } from "../types";
import { supabase, supabaseUrl, supabaseAnonKey } from "../src/lib/supabase";

const getAI = (providedKey?: string) => {
  // Prioritize provided key (from store), then env var
  const key = providedKey || (typeof process !== 'undefined' ? process.env.API_KEY : undefined);
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
};

export const generatePortfolioSummary = async (tasks: Task[], apiKey?: string): Promise<string> => {
  console.log("Generating Portfolio Summary. Supabase available:", !!supabase, "Manual API Key provided:", !!apiKey);

  // Try secure proxy first if Supabase is available and NO manual key is provided
  if (supabase && !apiKey) {
    try {
      console.log("[Portfolio] Using Direct Fetch for Proxy...");
      const functionUrl = `${supabaseUrl}/functions/v1/gemini-proxy`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey
        },
        body: JSON.stringify({ action: 'portfolio', payload: { tasks } })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        console.error("[Portfolio] Proxy Error Details:", errJson);
        throw new Error(errJson.error || `Proxy error ${response.status}`);
      }

      const data = await response.json();
      console.log("[Portfolio] Proxy Success! Received result.");
      return data.result;
    } catch (e: any) {
      console.error("[Portfolio] Secure proxy FETCH FAILED:", e.message || e);
    }
  }

  const ai = getAI(apiKey);
  if (!ai) throw new Error("API Key missing. Please configure it in Admin Settings.");

  const completedTasks = tasks.filter(t => t.status === 'Done');
  const taskSummary = completedTasks.map(t =>
    `- ${t.title} (${t.type}): ${t.description}. Tags: ${t.tags?.join(', ') || ''}`
  ).join('\n');

  const prompt = `
    You are helping an FTC Robotics team (high school students) write their Engineering Portfolio summary.
    Write in a casual, enthusiastic voice that sounds like it was actually written BY high school students.
    Use natural student phrases like "we figured out", "it was super cool when", "our team decided", "the hardest part was", "we were really proud of".
    Avoid corporate jargon or overly formal language - keep it authentic and passionate.
    Still highlight technical achievements and problem-solving, but make it sound like excited students explaining their work to judges.
    Format the output as a bulleted Markdown summary.
    
    IMPORTANT: Only use information that is explicitly provided in the tasks below. Do NOT make up, infer, or fabricate any details that are not documented.
    If there is insufficient data to write a comprehensive summary, acknowledge this and only describe what you can determine from the documented tasks.
    If there are no tasks or very few tasks, simply state that more documentation is needed and list only what was actually completed.
    
    Tasks completed this season:
    ${taskSummary || 'No tasks have been documented yet.'}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: prompt
    });
    return response.text || "Could not generate summary.";
  } catch (error) {
    throw new Error("AI Generation failed. Check API Key or limit.");
  }
};

export const generateInterviewQuestions = async (contextText: string, studyGuide?: string, apiKey?: string): Promise<Flashcard[]> => {
  if (supabase && !apiKey) {
    try {
      console.log("[Questions] Using Direct Fetch for Proxy...");
      const functionUrl = `${supabaseUrl}/functions/v1/gemini-proxy`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey
        },
        body: JSON.stringify({ action: 'questions', payload: { context: contextText, studyGuide } })
      });

      if (!response.ok) {
        throw new Error(`Proxy error ${response.status}`);
      }

      const data = await response.json();
      console.log("[Questions] Proxy Success!");

      // Robust JSON extraction
      let jsonStr = data.result;
      const jsonStart = jsonStr.indexOf('{');
      const jsonEnd = jsonStr.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
      }

      const json = JSON.parse(jsonStr);
      return json.questions || [];
    } catch (e: any) {
      console.error("[Questions] Secure proxy FETCH FAILED:", e.message || e);
    }
  }

  const ai = getAI(apiKey);
  if (!ai) throw new Error("API Key missing. Please configure it in Admin Settings.");

  const promptText = `
    Create 5 potential judge interview questions and answers for an FTC Robotics team.
    Base the questions on the provided context about the team's season and robot.
    Return the response as a JSON object with a list of "questions" (each with "question" and "answer" keys).
    
    Context: ${contextText}
    Study Guide: ${studyGuide || 'None'}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: promptText
  });
  try {
    const jsonStr = (response.text || "").replace(/```json|```/g, '').trim();
    const json = JSON.parse(jsonStr);
    return json.questions || [];
  } catch (e) {
    console.error("Failed to parse AI response", e);
    return [];
  }
};

// Credentials are imported from src/lib/supabase.ts

export const summarizeMeeting = async (notes: string, apiKey?: string): Promise<string> => {
  if (supabase && !apiKey) {
    try {
      console.log("[Summarize] Using Direct Fetch for Proxy...");
      const functionUrl = `${supabaseUrl}/functions/v1/gemini-proxy`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey
        },
        body: JSON.stringify({ action: 'summarize', payload: { text: notes } })
      });

      if (!response.ok) {
        throw new Error(`Proxy error ${response.status}`);
      }

      const data = await response.json();
      console.log("[Summarize] Proxy Success!");
      return data.result;
    } catch (e: any) {
      console.error("[Summarize] Secure proxy FETCH FAILED:", e.message || e);
    }
  }

  const ai = getAI(apiKey);
  if (!ai) throw new Error("API Key missing. Please configure it in Admin Settings.");

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: `Summarize these robotics team meeting notes into concise minutes with action items:\n\n${notes}`
  });
  return response.text || "";
}
