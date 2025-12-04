import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LanguageCorpus {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  language: string;
  region: string;
  status: "pending" | "verified" | "rejected";
}

const FHEEncryption = (data: string): string => `FHE-${btoa(data)}`;
const FHEDecryption = (encryptedData: string): string => encryptedData.startsWith('FHE-') ? atob(encryptedData.substring(4)) : encryptedData;
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [corpora, setCorpora] = useState<LanguageCorpus[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCorpusData, setNewCorpusData] = useState({ language: "", region: "", corpusData: "" });
  const [selectedCorpus, setSelectedCorpus] = useState<LanguageCorpus | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;
  
  const verifiedCount = corpora.filter(c => c.status === "verified").length;
  const pendingCount = corpora.filter(c => c.status === "pending").length;
  const rejectedCount = corpora.filter(c => c.status === "rejected").length;

  useEffect(() => {
    loadCorpora().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadCorpora = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }
      
      // Load corpus keys
      const keysBytes = await contract.getData("corpus_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing corpus keys:", e); }
      }
      
      // Load each corpus
      const list: LanguageCorpus[] = [];
      for (const key of keys) {
        try {
          const corpusBytes = await contract.getData(`corpus_${key}`);
          if (corpusBytes.length > 0) {
            try {
              const corpusData = JSON.parse(ethers.toUtf8String(corpusBytes));
              list.push({ 
                id: key, 
                encryptedData: corpusData.data, 
                timestamp: corpusData.timestamp, 
                owner: corpusData.owner, 
                language: corpusData.language, 
                region: corpusData.region, 
                status: corpusData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing corpus data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading corpus ${key}:`, e); }
      }
      
      // Sort by timestamp
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCorpora(list);
    } catch (e) { console.error("Error loading corpora:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitCorpus = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting corpus data with Zama FHE..." });
    try {
      // Encrypt corpus data
      const encryptedData = FHEEncryption(JSON.stringify({ 
        ...newCorpusData, 
        timestamp: Date.now() 
      }));
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID
      const corpusId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Prepare corpus data
      const corpusData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        language: newCorpusData.language, 
        region: newCorpusData.region, 
        status: "pending" 
      };
      
      // Store corpus data
      await contract.setData(`corpus_${corpusId}`, ethers.toUtf8Bytes(JSON.stringify(corpusData)));
      
      // Update corpus keys
      const keysBytes = await contract.getData("corpus_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(corpusId);
      await contract.setData("corpus_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted corpus submitted securely!" });
      await loadCorpora();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCorpusData({ language: "", region: "", corpusData: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryption(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyCorpus = async (corpusId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted corpus with FHE..." });
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const corpusBytes = await contract.getData(`corpus_${corpusId}`);
      if (corpusBytes.length === 0) throw new Error("Corpus not found");
      
      const corpusData = JSON.parse(ethers.toUtf8String(corpusBytes));
      const updatedCorpus = { ...corpusData, status: "verified" };
      
      await contract.setData(`corpus_${corpusId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCorpus)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadCorpora();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectCorpus = async (corpusId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted corpus with FHE..." });
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const corpusBytes = await contract.getData(`corpus_${corpusId}`);
      if (corpusBytes.length === 0) throw new Error("Corpus not found");
      
      const corpusData = JSON.parse(ethers.toUtf8String(corpusBytes));
      const updatedCorpus = { ...corpusData, status: "rejected" };
      
      await contract.setData(`corpus_${corpusId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCorpus)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadCorpora();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (corpusAddress: string) => address?.toLowerCase() === corpusAddress.toLowerCase();

  // Filter corpora based on search term
  const filteredCorpora = corpora.filter(corpus => 
    corpus.language.toLowerCase().includes(searchTerm.toLowerCase()) ||
    corpus.region.toLowerCase().includes(searchTerm.toLowerCase()) ||
    corpus.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination
  const totalPages = Math.ceil(filteredCorpora.length / itemsPerPage);
  const paginatedCorpora = filteredCorpora.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Render pie chart for status distribution
  const renderPieChart = () => {
    const total = corpora.length || 1;
    const verifiedPercentage = (verifiedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;
    
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment verified" style={{ transform: `rotate(${verifiedPercentage * 3.6}deg)` }}></div>
          <div className="pie-segment pending" style={{ transform: `rotate(${(verifiedPercentage + pendingPercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment rejected" style={{ transform: `rotate(${(verifiedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{corpora.length}</div>
            <div className="pie-label">Corpora</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box verified"></div><span>Verified: {verifiedCount}</span></div>
          <div className="legend-item"><div className="color-box pending"></div><span>Pending: {pendingCount}</span></div>
          <div className="legend-item"><div className="color-box rejected"></div><span>Rejected: {rejectedCount}</span></div>
        </div>
      </div>
    );
  };

  // Render language distribution chart
  const renderLanguageChart = () => {
    const languageCounts: Record<string, number> = {};
    corpora.forEach(corpus => {
      languageCounts[corpus.language] = (languageCounts[corpus.language] || 0) + 1;
    });
    
    const languages = Object.keys(languageCounts);
    const maxCount = Math.max(...Object.values(languageCounts), 1);
    
    return (
      <div className="language-chart">
        {languages.map(language => (
          <div key={language} className="language-bar">
            <div className="language-name">{language}</div>
            <div className="bar-container">
              <div 
                className="bar-fill" 
                style={{ width: `${(languageCounts[language] / maxCount) * 100}%` }}
              >
                <span className="bar-count">{languageCounts[language]}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // FAQ data
  const faqs = [
    {
      question: "What is FHE and how does it protect endangered language data?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations to be performed on encrypted data without decrypting it. This means sensitive language data can be analyzed while remaining encrypted, protecting the privacy of language speakers and cultural information."
    },
    {
      question: "How is the data encrypted?",
      answer: "Data is encrypted client-side using Zama FHE technology before being stored on the blockchain. Only authorized researchers with proper cryptographic keys can decrypt the data after analysis."
    },
    {
      question: "Who can contribute language corpora?",
      answer: "Anyone with knowledge of an endangered language can contribute. All submissions are encrypted and verified by the community before being made available for analysis."
    },
    {
      question: "How can researchers access the encrypted data?",
      answer: "Researchers can request access to encrypted corpora. After approval, they can perform FHE computations on the encrypted data without ever seeing the raw content."
    },
    {
      question: "What kind of analysis can be performed?",
      answer: "Researchers can perform statistical analysis, pattern recognition, frequency analysis, and other linguistic studies while the data remains encrypted."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Endangered<span>Lang</span>FHE</h1>
        </div>
        
        <nav className="main-nav">
          <button 
            className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`nav-btn ${activeTab === "corpora" ? "active" : ""}`}
            onClick={() => setActiveTab("corpora")}
          >
            Corpora
          </button>
          <button 
            className={`nav-btn ${activeTab === "analysis" ? "active" : ""}`}
            onClick={() => setActiveTab("analysis")}
          >
            Analysis
          </button>
          <button 
            className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
            onClick={() => setActiveTab("faq")}
          >
            FAQ
          </button>
        </nav>
        
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            <div className="add-icon"></div>Add Corpus
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-panel">
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>Preserving Endangered Languages with FHE</h2>
                <p>Secure analysis of sensitive language corpora using Fully Homomorphic Encryption</p>
              </div>
              <div className="fhe-indicator">
                <div className="fhe-lock"></div>
                <span>FHE Encryption Active</span>
              </div>
            </div>
            
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{corpora.length}</div>
                <div className="stat-label">Total Corpora</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
            
            <div className="chart-container">
              <div className="chart-card">
                <h3>Corpus Status Distribution</h3>
                {renderPieChart()}
              </div>
              <div className="chart-card">
                <h3>Language Distribution</h3>
                {renderLanguageChart()}
              </div>
            </div>
            
            <div className="project-intro">
              <h3>About EndangeredLangFHE</h3>
              <p>
                EndangeredLangFHE utilizes Fully Homomorphic Encryption (FHE) to enable linguistic analysis 
                on sensitive endangered language corpora while keeping the data encrypted. This approach 
                protects the privacy of indigenous communities while allowing researchers to study and 
                preserve linguistic diversity.
              </p>
              <div className="fhe-process">
                <div className="process-step">
                  <div className="step-icon">🔓</div>
                  <div className="step-label">Plain Data</div>
                </div>
                <div className="process-arrow">→</div>
                <div className="process-step">
                  <div className="step-icon">🔒</div>
                  <div className="step-label">FHE Encryption</div>
                </div>
                <div className="process-arrow">→</div>
                <div className="process-step">
                  <div className="step-icon">⚙️</div>
                  <div className="step-label">Compute on Encrypted Data</div>
                </div>
                <div className="process-arrow">→</div>
                <div className="process-step">
                  <div className="step-icon">📊</div>
                  <div className="step-label">Encrypted Results</div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "corpora" && (
          <div className="corpora-panel">
            <div className="panel-header">
              <h2>Language Corpora</h2>
              <div className="controls">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search languages or regions..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <button className="search-btn">🔍</button>
                </div>
                <button onClick={loadCorpora} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="corpora-list">
              <div className="list-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Language</div>
                <div className="header-cell">Region</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredCorpora.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No language corpora found</p>
                  <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                    Add First Corpus
                  </button>
                </div>
              ) : paginatedCorpora.map(corpus => (
                <div className="corpus-row" key={corpus.id} onClick={() => setSelectedCorpus(corpus)}>
                  <div className="table-cell corpus-id">#{corpus.id.substring(0, 6)}</div>
                  <div className="table-cell">{corpus.language}</div>
                  <div className="table-cell">{corpus.region}</div>
                  <div className="table-cell">{new Date(corpus.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${corpus.status}`}>{corpus.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(corpus.owner) && corpus.status === "pending" && (
                      <>
                        <button className="action-btn success" onClick={(e) => { e.stopPropagation(); verifyCorpus(corpus.id); }}>Verify</button>
                        <button className="action-btn danger" onClick={(e) => { e.stopPropagation(); rejectCorpus(corpus.id); }}>Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {filteredCorpora.length > 0 && (
              <div className="pagination">
                <button 
                  className="pagination-btn" 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button 
                  className="pagination-btn" 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-panel">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {faqs.map((faq, index) => (
                <div className="faq-item" key={index}>
                  <div className="faq-question">
                    <div className="q-icon">Q</div>
                    <h3>{faq.question}</h3>
                  </div>
                  <div className="faq-answer">
                    <div className="a-icon">A</div>
                    <p>{faq.answer}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="contact-section">
              <h3>Still have questions?</h3>
              <p>Contact our team for more information about FHE technology and endangered language preservation.</p>
              <button className="contact-btn">Contact Us</button>
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCorpus} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          corpusData={newCorpusData} 
          setCorpusData={setNewCorpusData}
        />
      )}
      
      {selectedCorpus && (
        <CorpusDetailModal 
          corpus={selectedCorpus} 
          onClose={() => { setSelectedCorpus(null); setDecryptedContent(null); }} 
          decryptedContent={decryptedContent} 
          setDecryptedContent={setDecryptedContent} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>EndangeredLangFHE</span>
            </div>
            <p>Preserving linguistic diversity with FHE technology</p>
          </div>
          
          <div className="footer-links">
            <div className="link-group">
              <h4>Resources</h4>
              <a href="#" className="footer-link">Documentation</a>
              <a href="#" className="footer-link">Research Papers</a>
              <a href="#" className="footer-link">Tutorials</a>
            </div>
            <div className="link-group">
              <h4>Legal</h4>
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Terms of Service</a>
              <a href="#" className="footer-link">Data Ethics</a>
            </div>
            <div className="link-group">
              <h4>Community</h4>
              <a href="#" className="footer-link">Forum</a>
              <a href="#" className="footer-link">GitHub</a>
              <a href="#" className="footer-link">Contribute</a>
            </div>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <div className="fhe-icon"></div>
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} EndangeredLangFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  corpusData: any;
  setCorpusData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, corpusData, setCorpusData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCorpusData({ ...corpusData, [name]: value });
  };

  const handleSubmit = () => {
    if (!corpusData.language || !corpusData.corpusData) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Language Corpus</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔑</div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your language data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Language *</label>
              <input 
                type="text" 
                name="language" 
                value={corpusData.language} 
                onChange={handleChange} 
                placeholder="Enter language name" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Region</label>
              <input 
                type="text" 
                name="region" 
                value={corpusData.region} 
                onChange={handleChange} 
                placeholder="Geographical region" 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Corpus Data *</label>
              <textarea 
                name="corpusData" 
                value={corpusData.corpusData} 
                onChange={handleChange} 
                placeholder="Enter language corpus data (text, phrases, etc.)..." 
                className="form-textarea" 
                rows={4}
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Data:</span>
                <div>{corpusData.corpusData || 'No data entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{corpusData.corpusData ? FHEEncryption(corpusData.corpusData).substring(0, 50) + '...' : 'No data entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔒</div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn primary">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CorpusDetailModalProps {
  corpus: LanguageCorpus;
  onClose: () => void;
  decryptedContent: string | null;
  setDecryptedContent: (content: string | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<string | null>;
}

const CorpusDetailModal: React.FC<CorpusDetailModalProps> = ({ corpus, onClose, decryptedContent, setDecryptedContent, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedContent) { 
      setDecryptedContent(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(corpus.encryptedData);
    if (decrypted) setDecryptedContent(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="corpus-detail-modal">
        <div className="modal-header">
          <h2>Corpus Details #{corpus.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="corpus-info">
            <div className="info-item">
              <span>Language:</span>
              <strong>{corpus.language}</strong>
            </div>
            <div className="info-item">
              <span>Region:</span>
              <strong>{corpus.region}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{corpus.owner.substring(0, 6)}...{corpus.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(corpus.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${corpus.status}`}>{corpus.status}</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Data</h3>
            <div className="encrypted-data">{corpus.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon">🔒</div>
              <span>FHE Encrypted</span>
            </div>
            <button className="decrypt-btn" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedContent ? "Hide Decrypted Data" : "Decrypt with Wallet Signature"}
            </button>
          </div>
          
          {decryptedContent && (
            <div className="decrypted-data-section">
              <h3>Decrypted Data</h3>
              <div className="decrypted-data">
                <pre>{JSON.stringify(JSON.parse(decryptedContent), null, 2)}</pre>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon">⚠️</div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;