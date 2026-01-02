import React, { useState } from 'react';
import { Task, Flashcard } from '../types';
import { generatePortfolioSummary, generateInterviewQuestions } from '../services/geminiService';
import { Sparkles, Download, ArrowRight, Loader2, UploadCloud } from 'lucide-react';

interface PortfolioAIProps {
  tasks: Task[];
  view: 'portfolio' | 'judging';
}

const PortfolioAI: React.FC<PortfolioAIProps> = ({ tasks, view }) => {
  const [generatedPortfolio, setGeneratedPortfolio] = useState('');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);
  const [flippedCard, setFlippedCard] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'done'>('done');

  // New Study Guide Context
  const [studyGuideText, setStudyGuideText] = useState('');
  const [fileName, setFileName] = useState('');

  const handleGeneratePortfolio = async () => {
    setLoading(true);
    const tasksToAnalyze = filterStatus === 'done' ? tasks.filter(t => t.status === 'Done') : tasks;

    try {
      const result = await generatePortfolioSummary(tasksToAnalyze);
      setGeneratedPortfolio(result);
    } catch (e) {
      alert("Error generating portfolio. Please check your API Key configuration.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateInterview = async () => {
    setLoading(true);
    try {
      const context = generatedPortfolio || "We built a great robot that has a high scoring autonomous and durable drivetrain.";
      const questions = await generateInterviewQuestions(context, studyGuideText);
      if (questions && questions.length > 0) {
        setFlashcards(questions);
      } else {
        // Fallback for demo
        setFlashcards([
          { question: "Describe your robot's drivetrain.", answer: "We use a mecanum drivetrain for omnidirectional movement." },
          { question: "What was your biggest challenge?", answer: "Our biggest challenge was consistent intake, which we solved with a compliant wheel system." },
          { question: "How did you use sensors?", answer: "We use odometry pods for precise localization during autonomous." }
        ]);
      }
    } catch (e) {
      alert("Error generating questions. Showing demo questions instead.");
      setFlashcards([
        { question: "Describe your robot's drivetrain.", answer: "We use a mecanum drivetrain for omnidirectional movement." },
        { question: "What was your biggest challenge?", answer: "Our biggest challenge was consistent intake, which we solved with a compliant wheel system." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setStudyGuideText(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  }

  return (
    <div className="h-full flex flex-col p-4 md:p-6 max-w-5xl mx-auto w-full">
      <div className="flex-1 overflow-y-auto">
        {view === 'portfolio' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-full">
            <div className="md:col-span-1 space-y-4">
              <div className="bg-orange-50 dark:bg-slate-800 p-4 rounded-xl border border-orange-100 dark:border-slate-700">
                <h3 className="font-bold text-orange-900 dark:text-orange-400 mb-2">Portfolio Helper</h3>
                <p className="text-sm text-orange-800/80 dark:text-slate-300 mb-4">
                  The AI analyzes your tasks to create a summary of your season's technical achievements.
                </p>

                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-2">Include Tasks</label>
                  <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-orange-100 dark:border-slate-600">
                    <button
                      onClick={() => setFilterStatus('done')}
                      className={`flex-1 py-1 text-xs font-medium rounded transition ${filterStatus === 'done' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      Completed Only
                    </button>
                    <button
                      onClick={() => setFilterStatus('all')}
                      className={`flex-1 py-1 text-xs font-medium rounded transition ${filterStatus === 'all' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      All Tasks
                    </button>
                  </div>
                </div>

                <div className="text-xs text-orange-800/60 dark:text-slate-400 font-mono bg-white/50 dark:bg-slate-900/50 p-2 rounded mb-4">
                  Tasks Analyzed: {filterStatus === 'done' ? tasks.filter(t => t.status === 'Done').length : tasks.length}
                </div>
                <button
                  onClick={handleGeneratePortfolio}
                  disabled={loading}
                  className="w-full bg-orange-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-orange-700 transition flex justify-center items-center gap-2"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  Generate Summary
                </button>
              </div>
            </div>

            <div className="md:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 h-full flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Generated Content</h3>
                {generatedPortfolio && (
                  <button className="text-xs flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900">
                    <Download size={14} /> Copy MD
                  </button>
                )}
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-700 dark:text-slate-300 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-100 dark:border-slate-700">
                {generatedPortfolio || <span className="text-slate-400 italic">Content will appear here...</span>}
              </div>
            </div>
          </div>
        )}

        {view === 'judging' && (
          <div className="h-full flex flex-col">
            <div className="space-y-6">
              {/* Context Input Section */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Study Guide & Context</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Upload a text file/PDF or paste content to help the AI ask better questions.</p>

                <div className="flex flex-col md:flex-row gap-4 mb-4">
                  <div className="flex-1 relative">
                    <textarea
                      className="w-full h-24 p-3 text-sm border rounded-lg bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white resize-none"
                      placeholder="Paste technical info, robot specs, or outreach details here..."
                      value={studyGuideText}
                      onChange={(e) => setStudyGuideText(e.target.value)}
                    ></textarea>
                  </div>
                  <div className="w-full md:w-48 flex flex-col justify-center items-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer relative py-4 md:py-0">
                    <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" accept=".txt,.md,.json" />
                    <UploadCloud className="text-slate-400 mb-2" />
                    <span className="text-xs text-slate-500 font-medium text-center px-2">{fileName || "Upload .txt"}</span>
                  </div>
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={handleGenerateInterview}
                    disabled={loading}
                    className="bg-orange-600 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-orange-700 transition flex items-center gap-2 shadow-sm"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    Generate Questions
                  </button>
                </div>
              </div>

              {/* Flashcards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 pb-6">
                {flashcards.length === 0 && !loading && (
                  <div className="col-span-full text-center py-10 text-slate-400 italic">
                    No flashcards yet. Add context and click Generate.
                  </div>
                )}

                {flashcards.map((card, idx) => (
                  <div
                    key={idx}
                    className="h-64 perspective-1000 cursor-pointer group"
                    onClick={() => setFlippedCard(flippedCard === idx ? null : idx)}
                  >
                    <div className={`relative w-full h-full transition-all duration-500 transform-style-3d ${flippedCard === idx ? 'rotate-y-180' : ''}`}>
                      {/* Front */}
                      <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700 p-6 flex flex-col items-center justify-center text-center backface-hidden shadow-sm group-hover:border-orange-200 dark:group-hover:border-slate-500">
                        <span className="text-xs uppercase font-bold text-orange-600 dark:text-orange-400 mb-2">Question {idx + 1}</span>
                        <p className="font-medium text-slate-800 dark:text-slate-100 select-none">{card.question}</p>
                        <div className="mt-4 text-xs text-slate-400 flex items-center gap-1">
                          Click to reveal answer <ArrowRight size={12} />
                        </div>
                      </div>

                      {/* Back */}
                      <div className="absolute w-full h-full bg-slate-800 dark:bg-slate-900 rounded-xl p-6 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180 shadow-xl border border-slate-700">
                        <span className="text-xs uppercase font-bold text-slate-400 mb-2">Suggested Answer</span>
                        <p className="text-slate-200 dark:text-slate-300 text-sm leading-relaxed select-none">{card.answer}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PortfolioAI;