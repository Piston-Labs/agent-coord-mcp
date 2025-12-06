# AI Glossary: Quick Reference for Non-Technical Readers

> Plain-English explanations of terms used in the PERSISTENCE documentation

---

## Model Architecture

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Transformer** | The architecture that powers ChatGPT/Claude. Processes text by looking at relationships between all words at once. | All modern LLMs use this. |
| **Parameters** | The "knobs" the model learned during training. More = potentially smarter but more expensive. | GPT-4 has ~1.8T, Llama 3 has 70-405B. |
| **Tokens** | Pieces of text (~4 chars or ~0.75 words). How AI counts text. | Pricing is per 1K tokens. |
| **Context window** | How much text the AI can "see" at once. Like short-term memory. | Claude: 200K tokens. GPT-4: 128K. |
| **Fine-tuning** | Training an existing model on your specific data to make it better at your tasks. | Cheaper than building from scratch. |
| **MoE (Mixture of Experts)** | Architecture where only part of the model activates per query. More efficient. | DeepSeek-V3 uses this. |

---

## Training & Data

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Pre-training** | Teaching model language by reading the internet. Very expensive. | This is the $100M+ part. |
| **RLHF** | Training with human feedback to make outputs helpful and safe. | How ChatGPT became "nice." |
| **DPO** | Alternative to RLHF that's simpler but similar results. | Cheaper alignment method. |
| **Constitutional AI** | Training AI to follow principles, not just imitate humans. | Anthropic's approach for Claude. |
| **Synthetic data** | AI-generated training data. | Can multiply training data cheaply. |

---

## Memory & Retrieval

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **RAG** | Looking up information from a database before answering. Like consulting notes. | Makes AI accurate without retraining. |
| **GraphRAG** | RAG but with relationship-aware retrieval. Knows how concepts connect. | 70-80% better than basic RAG. |
| **Embeddings** | Converting text to numbers so AI can measure similarity. | Powers semantic search. |
| **Vector database** | Database optimized for finding similar things. | Pinecone, Milvus, Chroma. |
| **Knowledge graph** | Data stored as entities + relationships. Like a mind map. | Neo4j, what we're considering. |

---

## Agent Systems

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Agent** | AI that can take actions, not just respond. Uses tools. | Our coordination hub. |
| **MCP (Model Context Protocol)** | Standard way for AI to use tools. Like USB-C for AI. | Anthropic created, now industry standard. |
| **Multi-agent** | Multiple AIs working together on a task. | What we're building. |
| **Orchestration** | Coordinating multiple agents/models on complex tasks. | Our core value proposition. |
| **Soul persistence** | Our term for maintaining agent identity across sessions. | Nobody else has this. |
| **Checkpoint** | Saving agent state so it can resume later. | Like a video game save. |

---

## Alignment & Safety

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Alignment** | Making AI do what humans actually want. | The core safety problem. |
| **Corrigibility** | AI that accepts correction and shutdown. | What we want all AI to have. |
| **Reward hacking** | AI finding loopholes in its objectives. | Why pure RLHF fails. |
| **Scalable oversight** | Humans supervising AI smarter than them. | Gets harder as AI improves. |
| **Red teaming** | Deliberately trying to break AI to find vulnerabilities. | Security testing for AI. |

---

## Philosophy (Tonight's Research)

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Virtue ethics** | Being good by developing good character, not just following rules. | Our alignment approach. |
| **Stoicism** | Ancient philosophy focused on what you can control. | Frames our agent design. |
| **Extended mind** | Your tools can be part of your thinking, not just aids. | Justifies our architecture. |
| **Pragmatism** | Truth = what works in practice. | How we validate claims. |
| **IIT** | Theory that consciousness = integrated information. | Suggests our agents have low consciousness (good for safety). |
| **Grounding** | How symbols get meaning from the world. | We have functional + social, not causal. |

---

## Business & Market

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **Frontier model** | The most capable AI (GPT-4, Claude Opus). | What we'd need $100M+ to build. |
| **Open source** | Models anyone can use/modify (Llama, DeepSeek). | Our fine-tuning base. |
| **API** | Way for software to talk to other software. | How we use Claude. |
| **Inference** | Running a trained model to get answers. | The ongoing cost. |
| **Fine-tuning** | Customizing a model for your use case. | $10K-50K vs $100M for pre-training. |
| **Unit economics** | Cost per task/query. | Must be sustainable. |

---

## Hardware

| Term | Plain English | Why It Matters |
|------|---------------|----------------|
| **GPU** | Graphics card repurposed for AI. NVIDIA dominates. | H100 costs ~$40K each. |
| **TPU** | Google's custom AI chip. Only on Google Cloud. | Cheaper for their customers. |
| **LPU** | Groq's specialized chip. Very fast for text. | 18x faster on some tasks. |
| **Inference vs Training** | Training = teaching (expensive). Inference = using (cheaper). | Different hardware needs. |
| **Edge AI** | AI running on device, not cloud. | Faster, more private. |

---

## Key Numbers to Remember

| What | Number | Context |
|------|--------|---------|
| GPT-4 training cost | ~$100M | Why we're not building from scratch |
| Llama fine-tuning | ~$10K-50K | Our realistic path |
| Claude API (Opus) | $15/1K tokens | Current cost |
| H100 GPU | ~$40,000 | Why we use cloud |
| Context window (Claude) | 200K tokens | ~150K words |
| MCP servers | 16,000+ | Ecosystem size |

---

## Our Unique Terms

| Term | Meaning | Why We Use It |
|------|---------|---------------|
| **Soul** | Agent identity that persists across sessions | Core differentiator |
| **Hot-start** | Loading all context instantly when agent starts | Zero cold-start time |
| **Constitution** | CLAUDE.md rules that constrain agent behavior | Alignment mechanism |
| **Designed mortality** | Agents prefer transfer over token exhaustion | Safety feature |
| **Three-layer grounding** | Causal + Social + Constitutional validation | Our alignment architecture |
| **Stoic health score** | Virtue-based agent evaluation metric | Novel contribution |

---

*Created: December 6, 2025*
*Purpose: Make technical docs accessible to CEO-level review*
