// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EndangeredLangFHE is SepoliaConfig {
    struct EncryptedText {
        uint256 textId;
        euint32 encryptedWordCount;
        euint32 encryptedUniqueWordCount;
        euint32 encryptedAvgWordLength;
        uint256 timestamp;
    }

    struct LanguageAnalysis {
        euint32 encryptedTotalWords;
        euint32 encryptedTotalTexts;
        euint32 encryptedLexicalDiversity;
        bool isRevealed;
    }

    struct DecryptedAnalysis {
        uint32 totalWords;
        uint32 totalTexts;
        uint32 lexicalDiversity;
        bool isRevealed;
    }

    mapping(address => bool) public authorizedResearchers;
    mapping(uint256 => EncryptedText) public encryptedTexts;
    mapping(uint256 => LanguageAnalysis) public languageAnalyses;
    mapping(uint256 => DecryptedAnalysis) public decryptedAnalyses;
    
    uint256 public textCount;
    uint256 public analysisCount;
    address public admin;
    
    event ResearcherAdded(address indexed researcher);
    event TextUploaded(uint256 indexed textId);
    event AnalysisRequested(uint256 indexed analysisId);
    event AnalysisCompleted(uint256 indexed analysisId);
    event AnalysisRevealed(uint256 indexed analysisId);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Admin only");
        _;
    }

    modifier onlyResearcher() {
        require(authorizedResearchers[msg.sender], "Unauthorized researcher");
        _;
    }

    function addResearcher(address researcher) public onlyAdmin {
        authorizedResearchers[researcher] = true;
        emit ResearcherAdded(researcher);
    }

    function uploadEncryptedText(
        euint32 wordCount,
        euint32 uniqueWordCount,
        euint32 avgWordLength
    ) public onlyResearcher {
        textCount++;
        encryptedTexts[textCount] = EncryptedText({
            textId: textCount,
            encryptedWordCount: wordCount,
            encryptedUniqueWordCount: uniqueWordCount,
            encryptedAvgWordLength: avgWordLength,
            timestamp: block.timestamp
        });
        emit TextUploaded(textCount);
    }

    function requestLanguageAnalysis() public onlyResearcher returns (uint256) {
        analysisCount++;
        uint256 newAnalysisId = analysisCount;
        
        languageAnalyses[newAnalysisId] = LanguageAnalysis({
            encryptedTotalWords: FHE.asEuint32(0),
            encryptedTotalTexts: FHE.asEuint32(0),
            encryptedLexicalDiversity: FHE.asEuint32(0),
            isRevealed: false
        });
        
        decryptedAnalyses[newAnalysisId] = DecryptedAnalysis({
            totalWords: 0,
            totalTexts: 0,
            lexicalDiversity: 0,
            isRevealed: false
        });

        emit AnalysisRequested(newAnalysisId);
        return newAnalysisId;
    }

    function performAnalysis(uint256 analysisId) public onlyResearcher {
        require(!languageAnalyses[analysisId].isRevealed, "Already analyzed");
        
        euint32 totalWords = FHE.asEuint32(0);
        euint32 totalTexts = FHE.asEuint32(0);
        euint32 totalUniqueWords = FHE.asEuint32(0);
        
        for (uint256 i = 1; i <= textCount; i++) {
            totalWords = FHE.add(totalWords, encryptedTexts[i].encryptedWordCount);
            totalUniqueWords = FHE.add(totalUniqueWords, encryptedTexts[i].encryptedUniqueWordCount);
            totalTexts = FHE.add(totalTexts, FHE.asEuint32(1));
        }
        
        euint32 lexicalDiversity = FHE.div(
            FHE.mul(totalUniqueWords, FHE.asEuint32(100)),
            totalWords
        );
        
        languageAnalyses[analysisId] = LanguageAnalysis({
            encryptedTotalWords: totalWords,
            encryptedTotalTexts: totalTexts,
            encryptedLexicalDiversity: lexicalDiversity,
            isRevealed: false
        });

        emit AnalysisCompleted(analysisId);
    }

    function requestAnalysisDecryption(uint256 analysisId) public onlyResearcher {
        require(!languageAnalyses[analysisId].isRevealed, "Already revealed");
        
        LanguageAnalysis storage analysis = languageAnalyses[analysisId];
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(analysis.encryptedTotalWords);
        ciphertexts[1] = FHE.toBytes32(analysis.encryptedTotalTexts);
        ciphertexts[2] = FHE.toBytes32(analysis.encryptedLexicalDiversity);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public onlyResearcher {
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint256 latestAnalysisId = analysisCount;
        
        decryptedAnalyses[latestAnalysisId] = DecryptedAnalysis({
            totalWords: results[0],
            totalTexts: results[1],
            lexicalDiversity: results[2],
            isRevealed: true
        });
        
        languageAnalyses[latestAnalysisId].isRevealed = true;
        emit AnalysisRevealed(latestAnalysisId);
    }

    function calculateWordFrequency(
        euint32[] memory encryptedWordHashes,
        euint32 targetWordHash
    ) public view onlyResearcher returns (euint32) {
        euint32 frequency = FHE.asEuint32(0);
        
        for (uint256 i = 0; i < encryptedWordHashes.length; i++) {
            ebool isMatch = FHE.eq(encryptedWordHashes[i], targetWordHash);
            frequency = FHE.add(frequency, FHE.select(isMatch, FHE.asEuint32(1), FHE.asEuint32(0)));
        }
        
        return frequency;
    }

    function getTextCount() public view returns (uint256) {
        return textCount;
    }

    function getAnalysisCount() public view returns (uint256) {
        return analysisCount;
    }

    function getDecryptedAnalysis(uint256 analysisId) public view returns (
        uint32 totalWords,
        uint32 totalTexts,
        uint32 lexicalDiversity,
        bool isRevealed
    ) {
        DecryptedAnalysis storage analysis = decryptedAnalyses[analysisId];
        return (
            analysis.totalWords,
            analysis.totalTexts,
            analysis.lexicalDiversity,
            analysis.isRevealed
        );
    }
}