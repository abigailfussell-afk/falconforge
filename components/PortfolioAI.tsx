import React, { useState } from 'react';
import { Task, Flashcard } from '../types';
import { generatePortfolioSummary, generateInterviewQuestions } from '../services/geminiService';
import { useAppStore, PortfolioEntry } from '../src/lib/store';
import { Sparkles, Download, ArrowRight, Loader2, UploadCloud, CloudOff, Clock, Trash2, FileText, X } from 'lucide-react';
import { useSync } from '../src/lib/sync';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Set up PDF.js worker using unpkg (mirrors npm packages directly)
GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';

interface UploadedFile {
  name: string;
  content: string;
}

interface PortfolioAIProps {
  tasks: Task[];
  view: 'portfolio' | 'judging';
}

const PortfolioAI: React.FC<PortfolioAIProps> = ({ tasks, view }) => {
  const geminiApiKey = useAppStore((state: any) => state.geminiApiKey);
  const allPortfolioHistory = useAppStore((state: any) => state.portfolioHistory) as PortfolioEntry[];
  const currentSeasonId = useAppStore((state: any) => state.currentSeasonId);
  const addPortfolioEntry = useAppStore((state: any) => state.addPortfolioEntry);
  const deletePortfolioEntry = useAppStore((state: any) => state.deletePortfolioEntry);
  // Filter portfolio history by current season
  const portfolioHistory = allPortfolioHistory.filter((p: PortfolioEntry) => !p.seasonId || p.seasonId === currentSeasonId);
  const { isOnline } = useSync();
  const [generatedPortfolio, setGeneratedPortfolio] = useState('');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);
  const [flippedCard, setFlippedCard] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'done'>('done');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  // Separate state for manual text and uploaded files
  const [manualNotes, setManualNotes] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleGeneratePortfolio = async () => {
    setLoading(true);
    setSelectedHistoryId(null);
    const tasksToAnalyze = filterStatus === 'done' ? tasks.filter(t => t.status === 'Done') : tasks;

    try {
      // Pass the API key explicitly
      const result = await generatePortfolioSummary(tasksToAnalyze, geminiApiKey || undefined);
      setGeneratedPortfolio(result);
      // Save to history
      addPortfolioEntry(result, tasksToAnalyze.length);
    } catch (e) {
      alert("Error generating portfolio. Please check your API Key configuration in Admin Settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHistory = (entry: PortfolioEntry) => {
    setGeneratedPortfolio(entry.content);
    setSelectedHistoryId(entry.id);
  };

  const handleDeleteHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDeleteHistory = () => {
    if (!deleteConfirmId) return;
    deletePortfolioEntry(deleteConfirmId);
    if (selectedHistoryId === deleteConfirmId) {
      setGeneratedPortfolio('');
      setSelectedHistoryId(null);
    }
    setDeleteConfirmId(null);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Combine manual notes and all uploaded file contents for AI context
  const getFullContext = () => {
    const fileContents = uploadedFiles.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n');
    return [manualNotes, fileContents].filter(Boolean).join('\n\n');
  };

  const handleGenerateInterview = async () => {
    setLoading(true);
    try {
      const context = generatedPortfolio || "We built a great robot that has a high scoring autonomous and durable drivetrain.";
      const studyGuideContext = getFullContext();
      const questions = await generateInterviewQuestions(context, studyGuideContext, geminiApiKey || undefined);
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

  const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      }

      return fullText.trim();
    } catch (error) {
      console.error('PDF extraction error:', error);
      throw new Error('Failed to extract text from PDF');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if file already uploaded
    if (uploadedFiles.some(f => f.name === file.name)) {
      alert('This file has already been uploaded.');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      let content = '';

      if (file.name.endsWith('.pdf')) {
        content = await extractTextFromPdf(file);
      } else if (file.name.endsWith('.txt')) {
        content = await file.text();
      } else {
        alert('Please upload a PDF or TXT file.');
        return;
      }

      setUploadedFiles(prev => [...prev, { name: file.name, content }]);
    } catch (error) {
      console.error('Error reading file:', error);
      alert('Error reading file. Please try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto w-full overflow-y-auto">
      <div className="flex-1">
        {view === 'portfolio' && (
          <>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Portfolio Helper</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-6">
              {/* Left Panel - Controls */}
              <div className="md:col-span-2 space-y-4">
                <div className="bg-orange-50 dark:bg-slate-800 p-3 md:p-4 rounded-xl border border-orange-100 dark:border-slate-700">
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
                    disabled={loading || !isOnline}
                    className="w-full bg-orange-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-orange-700 transition flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : (isOnline ? <Sparkles size={18} /> : <CloudOff size={18} />)}
                    {!isOnline ? 'Offline - AI Disabled' : 'Generate Summary'}
                  </button>
                  {!isOnline && (
                    <p className="text-[10px] text-center text-slate-500 mt-2">Connecting to internet will enable AI features.</p>
                  )}
                </div>

                {/* History Panel */}
                <div className="bg-white dark:bg-slate-800 p-3 md:p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <h3 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2 text-sm">
                    <Clock size={16} /> History
                  </h3>
                  {portfolioHistory.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No saved summaries yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {portfolioHistory.map((entry: PortfolioEntry) => (
                        <div
                          key={entry.id}
                          onClick={() => handleSelectHistory(entry)}
                          className={`p-2 rounded-lg cursor-pointer transition text-sm border ${selectedHistoryId === entry.id
                            ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700'
                            : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(entry.createdAt)}</p>
                              <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{entry.taskCount} tasks</p>
                            </div>
                            <button
                              onClick={(e) => handleDeleteHistory(e, entry.id)}
                              className="text-slate-400 hover:text-red-500 transition p-1 shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Panel - Generated Content */}
              <div className="md:col-span-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 h-full flex flex-col">
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
          </>
        )}

        {view === 'judging' && (
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Judging Prep</h2>
            <div className="space-y-6">
              {/* Context Input Section */}
              <div className="bg-white dark:bg-slate-800 p-3 md:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Study Guide & Context</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Upload PDF or TXT files, or add manual notes to help the AI generate better practice questions.</p>

                {/* Manual Notes Textarea */}
                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-2">Additional Notes</label>
                  <textarea
                    className="w-full h-24 p-3 text-sm border rounded-lg bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white resize-none"
                    placeholder="Add any extra context, robot specs, or outreach details here..."
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                  ></textarea>
                </div>

                {/* Uploaded Files Section */}
                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-2">Included Files</label>
                  {uploadedFiles.length === 0 ? (
                    <p className="text-xs text-slate-400 italic mb-2">No files uploaded yet.</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {uploadedFiles.map((file) => (
                        <div key={file.name} className="flex items-center justify-between bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText size={16} className="text-orange-500 shrink-0" />
                            <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{file.name}</span>
                            <span className="text-xs text-slate-400">({(file.content.length / 1000).toFixed(1)}k chars)</span>
                          </div>
                          <button
                            onClick={() => handleRemoveFile(file.name)}
                            className="text-slate-400 hover:text-red-500 transition p-1 shrink-0"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload Button */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer transition">
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        className="hidden"
                        accept=".pdf,.txt"
                        disabled={isUploading}
                      />
                      {isUploading ? (
                        <Loader2 size={16} className="animate-spin text-slate-500" />
                      ) : (
                        <UploadCloud size={16} className="text-slate-500" />
                      )}
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        {isUploading ? 'Processing...' : 'Upload PDF or TXT'}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-center flex-col items-center gap-2 pt-4 mt-2 border-t border-slate-200 dark:border-slate-700">
                  <button
                    onClick={handleGenerateInterview}
                    disabled={loading || !isOnline}
                    className="bg-orange-600 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-orange-700 transition flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : (isOnline ? <Sparkles size={16} /> : <CloudOff size={16} />)}
                    {!isOnline ? 'Offline - AI Disabled' : 'Generate Questions'}
                  </button>
                  {!isOnline && (
                    <p className="text-[10px] text-slate-500">AI generation requires an internet connection.</p>
                  )}
                </div>
              </div>

              {/* Flashcards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-6 pb-4 md:pb-6">
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
                        <div className="max-h-full overflow-y-auto custom-scrollbar pr-1">
                          <p className="font-medium text-slate-800 dark:text-slate-100 select-none break-words">{card.question}</p>
                        </div>
                        <div className="mt-4 text-xs text-slate-400 flex items-center gap-1 shrink-0">
                          Click to reveal answer <ArrowRight size={12} />
                        </div>
                      </div>

                      {/* Back */}
                      <div className="absolute w-full h-full bg-slate-800 dark:bg-slate-900 rounded-xl p-6 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180 shadow-xl border border-slate-700">
                        <span className="text-xs uppercase font-bold text-slate-400 mb-2">Suggested Answer</span>
                        <div className="max-h-full overflow-y-auto custom-scrollbar pr-1">
                          <p className="text-slate-200 dark:text-slate-300 text-sm leading-relaxed select-none break-words">{card.answer}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Delete History Entry?</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              This portfolio summary will be permanently deleted. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistory}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioAI;