// Setup for Supabase Edge Functions
import { GoogleGenAI } from "npm:@google/genai@1.34.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    console.log("--- PROXY REQUEST RECEIVED ---")

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const json = await req.json().catch(() => null)
        if (!json) {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            })
        }

        const { action, payload } = json
        const apiKey = Deno.env.get('GEMINI_API_KEY')

        if (!apiKey) {
            console.error('CRITICAL ERROR: GEMINI_API_KEY is not set')
            return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is missing in secrets' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500
            })
        }

        // Initialize SDK
        const ai = new GoogleGenAI({ apiKey })

        // Diagnostic Action: List Models
        if (action === 'list_models') {
            console.log("Listing available models...")
            try {
                const models = await ai.models.list()
                return new Response(JSON.stringify({ result: models }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200
                })
            } catch (listError: any) {
                console.error("Failed to list models:", listError.message)
                throw listError
            }
        }

        let promptText = ""
        if (action === 'summarize') {
            promptText = `Summarize these robotics team meeting notes into concise minutes with action items:\n\n${payload?.text || ''}`
        } else if (action === 'portfolio') {
            const tasks = payload?.tasks || []
            const taskSummary = tasks.map((t: any) =>
                `- ${t.title} (${t.type}): ${t.description}`
            ).join('\n')
            promptText = `You are helping an FTC Robotics team (high school students) write their Engineering Portfolio summary.
Write in a casual, enthusiastic voice that sounds like it was actually written BY high school students.
Use natural student phrases like "we figured out", "it was super cool when", "our team decided", "the hardest part was", "we were really proud of".
Avoid corporate jargon or overly formal language - keep it authentic and passionate.
Still highlight technical achievements and problem-solving, but make it sound like excited students explaining their work to judges.
Format the output as a bulleted Markdown summary.

Tasks completed this season:
${taskSummary}`
        } else if (action === 'questions') {
            promptText = `You are a coach for an FTC (FIRST Tech Challenge) robotics team comprised of high school students. 
      Create 5 potential judge interview questions and suggested answers.
      The answers should be written in a professional yet enthusiastic tone, typical of a high-school student who is passionate about their engineering work.
      Use natural student language (e.g., "We found that...", "Our team decided to...", "The biggest challenge was...") and avoid overly corporate jargon.
      
      Context from team: ${payload?.context || ''}
      Resource Guide: ${payload?.studyGuide || 'None'}
      
      Return the response as a JSON object with a "questions" array containing "question" and "answer" keys.`
        } else {
            return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            })
        }

        console.log(`Action: ${action}. Calling Gemini (2.5-flash)...`)

        /**
         * Switching to Gemini 2.0 Flash as it was confirmed present in discovery.
         * The environment seems to prefer the newer models or has specific visibility for them.
         */
        const result = await ai.models.generateContent({
            model: "models/gemini-2.5-flash",
            contents: promptText
        })

        console.log("Gemini responded successfully.")

        return new Response(JSON.stringify({ result: result.text }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error: any) {
        console.error('--- EDGE FUNCTION ERROR ---')
        console.error(error.message)
        return new Response(JSON.stringify({
            error: error.message,
            details: error.toString()
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        })
    }
})
