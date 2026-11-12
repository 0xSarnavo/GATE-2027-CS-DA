#!/usr/bin/env python3
"""Regenerates app/seed/topics.json and app/profiles/owner/plan.json (and the weekly table in
app/spec/02-study-plan.md between the WEEKS_TABLE markers).
Run:  python3 build_plan.py
Plan assumptions: today 2026-10-06; start 2026-10-07; Puja Shashthi 17 Oct - Bengal Dashami 21 Oct 2026;
full plan from Mon 2026-10-26; first paper assumed Sat 2027-02-06; plan ends 2027-02-21.
"""
import json, os, re
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "..", "..", "spec", "02-study-plan.md")
D = date.fromisoformat
START, END = D("2026-10-07"), D("2027-02-21")
EXAM1 = D("2027-02-06")

# ---------------------------------------------------------------- topics
# (id, name, parent, paper, syllabus_text)
ROOTS = [
 ("prob","Probability and Statistics","shared"),("la","Linear Algebra","shared"),
 ("calc","Calculus","shared"),("ds","Programming and Data Structures","shared"),
 ("algo","Algorithms","shared"),("db","Databases (DBMS)","shared"),
 ("dm","Discrete Mathematics","CS"),("dl","Digital Logic","CS"),
 ("coa","Computer Organization and Architecture","CS"),("toc","Theory of Computation","CS"),
 ("cd","Compiler Design","CS"),("os","Operating System","CS"),("net","Computer Networks","CS"),
 ("ml","Machine Learning","DA"),("ai","Artificial Intelligence","DA"),
 ("ga","General Aptitude","GA"),
]
L = [
# prob
("prob.counting","Counting: permutations and combinations","prob","shared","Counting (permutation and combinations) [DA S1]; Combinatorics: counting [CS S1]"),
("prob.axioms","Probability axioms, sample space, events, independence","prob","shared","Probability axioms, sample space, events, independent events, mutually exclusive events"),
("prob.conditional","Marginal, joint and conditional probability","prob","shared","marginal, conditional and joint probability; Conditional probability [CS]"),
("prob.bayes","Bayes theorem and total probability","prob","shared","Bayes Theorem [DA S1]; Conditional probability and Bayes theorem [CS S1]"),
("prob.rv","Random variables, PMF, PDF, CDF","prob","shared","random variables, discrete random variables and probability mass functions, continuous random variables and probability distribution function, cumulative distribution function"),
("prob.discrete","Discrete distributions: uniform, Bernoulli, binomial, Poisson","prob","shared","uniform, Bernoulli, binomial distribution; Poisson"),
("prob.continuous","Continuous distributions: uniform, exponential, normal, standard normal","prob","shared","uniform, exponential, Poisson, normal, standard normal"),
("prob.desc","Mean, median, mode, SD, correlation and covariance","prob","shared","mean, median, mode and standard deviation, correlation, and covariance"),
("prob.condexp","Conditional expectation, variance and conditional PDF","prob","DA","conditional expectation and variance, Conditional PDF"),
("prob.clt_ci","t and chi-squared distributions, CLT, confidence intervals","prob","DA","t-distribution, chi-squared distributions, Central limit theorem, confidence interval"),
("prob.tests","Hypothesis tests: z-test, t-test, chi-squared test","prob","DA","z-test, t-test, chi-squared test"),
# la
("la.vecspace","Vector spaces, subspaces, linear independence","la","DA","Vector space, subspaces, linear dependence and independence of vectors"),
("la.matrices_det","Matrices and determinants","la","shared","matrices, determinant; Matrices, determinants [CS]"),
("la.systems_rank","Linear systems, Gaussian elimination, rank and nullity","la","shared","systems of linear equations and solutions; Gaussian elimination, rank, nullity"),
("la.eigen","Eigenvalues and eigenvectors","la","shared","eigenvalues and eigenvectors"),
("la.lu","LU decomposition","la","shared","LU decomposition"),
("la.proj","Projections, orthogonal/idempotent/partition matrices, quadratic forms","la","DA","projection matrix, orthogonal matrix, idempotent matrix, partition matrix and their properties, quadratic forms, projections"),
("la.svd","Singular value decomposition","la","DA","singular value decomposition"),
# calc
("calc.limits","Limits, continuity and differentiability","calc","shared","Functions of a single variable, limit, continuity and differentiability"),
("calc.taylor","Taylor series","calc","DA","Taylor series"),
("calc.maxmin","Maxima and minima, single-variable optimisation","calc","shared","maxima and minima, optimization involving a single variable"),
("calc.mvt_integration","Mean value theorem and integration","calc","CS","Mean value theorem, Integration"),
# ds
("ds.python","Python programming refresh","ds","DA","Programming in Python [DA S4]"),
("ds.c","Programming in C: pointers, storage, output tracing","ds","CS","Programming in C"),
("ds.recursion","Recursion","ds","CS","Recursion"),
("ds.arrays","Arrays","ds","CS","Arrays"),
("ds.stacks","Stacks","ds","shared","stacks"),
("ds.queues","Queues","ds","shared","queues"),
("ds.linkedlist","Linked lists","ds","shared","linked lists"),
("ds.trees","Trees and binary search trees","ds","shared","trees, binary search trees"),
("ds.heaps","Binary heaps","ds","CS","binary heaps"),
("ds.graphs","Graph representations","ds","shared","graphs; introduction to graph theory [DA]"),
# algo
("algo.complexity","Asymptotic time and space complexity, recurrences","algo","CS","Asymptotic worst case time and space complexity"),
("algo.searching","Searching: linear and binary search","algo","shared","Search algorithms: linear search and binary search"),
("algo.sorting","Sorting: selection, bubble, insertion, merge, quick","algo","shared","basic sorting algorithms: selection sort, bubble sort and insertion sort; mergesort, quicksort"),
("algo.hashing","Hashing and hash tables","algo","shared","hashing [CS]; hash tables [DA]"),
("algo.dnc","Divide and conquer","algo","shared","divide-and-conquer"),
("algo.traversal","Graph traversals: BFS and DFS","algo","shared","Graph traversals; basic graph algorithms: traversals"),
("algo.shortest","Shortest paths","algo","shared","shortest paths"),
("algo.greedy","Greedy algorithms","algo","CS","greedy"),
("algo.dp","Dynamic programming","algo","CS","dynamic programming"),
("algo.mst","Minimum spanning trees","algo","CS","minimum spanning trees"),
# db
("db.er","ER model","db","shared","ER-model"),
("db.relalg","Relational model, relational algebra, tuple calculus","db","shared","Relational model: relational algebra, tuple calculus"),
("db.sql","SQL","db","shared","SQL"),
("db.nf","Integrity constraints and normal forms","db","shared","Integrity constraints, normal forms"),
("db.index","File organization and indexing (B and B+ trees)","db","shared","File organization, indexing (e.g., B and B+ trees)"),
("db.txn","Transactions and serializability","db","CS","Transactions"),
("db.cc","Concurrency control","db","CS","concurrency control"),
("db.transform","Data types and data transformation: normalization, discretization, sampling, compression","db","DA","data types, data transformation such as normalization, discretization, sampling, compression"),
("db.warehouse","Data warehouse schemas: multidimensional models","db","DA","data warehouse modelling: schema for multidimensional data models"),
("db.hierarchy","Concept hierarchies and measures","db","DA","concept hierarchies, measures: categorization and computations"),
# dm
("dm.logic","Propositional and first-order logic","dm","CS","Propositional and first order logic"),
("dm.sets_rel","Sets, relations, functions, partial orders, lattices","dm","CS","Sets, relations, functions, partial orders and lattices"),
("dm.algebra","Monoids and groups","dm","CS","Monoids, Groups"),
("dm.graphs","Graph theory: connectivity, matching, colouring","dm","CS","Graphs: connectivity, matching, colouring"),
("dm.counting","Combinatorics: counting","dm","CS","Combinatorics: counting"),
("dm.recurrence","Recurrence relations and generating functions","dm","CS","recurrence relations, generating functions"),
# dl
("dl.boolean_min","Boolean algebra and algebraic minimisation","dl","CS","Boolean algebra and minimization – algebraic technique"),
("dl.kmap_tabular","Karnaugh map and tabular (Quine-McCluskey) method","dl","CS","Karnaugh map, tabular method"),
("dl.comb","Combinational circuit design","dl","CS","Design of combinational circuits"),
("dl.seq","Sequential circuit design","dl","CS","sequential circuits"),
("dl.number","Number representation and arithmetic (fixed and floating point)","dl","CS","Number representation and arithmetic (fixed and floating point)"),
# coa
("coa.isa","Instruction set and addressing modes","coa","CS","Instruction set and addressing modes"),
("coa.alu","ALU design","coa","CS","Design of arithmetic and logic unit (ALU)"),
("coa.control","Control unit: hardwired and microprogrammed","coa","CS","Design of control unit – hardwired and microprogrammed"),
("coa.memory","Memory interfacing, hierarchy, cache mapping and performance","coa","CS","Memory interfacing and hierarchy: performance, cache memory mapping"),
("coa.io","I/O interface: interrupt and DMA","coa","CS","I/O interface (interrupt and DMA)"),
("coa.pipeline","Instruction pipelining and hazards","coa","CS","Instruction pipelining, pipeline hazards"),
# toc
("toc.fa_re","Regular expressions and finite automata","toc","CS","Regular expressions and finite automata"),
("toc.cfg_pda","Context-free grammars and push-down automata","toc","CS","Context-free grammars and push-down automata"),
("toc.langs_pumping","Regular and context-free languages, pumping lemma","toc","CS","Regular and context-free languages, pumping lemma"),
("toc.tm","Turing machines and undecidability","toc","CS","Turing machines and undecidability"),
# cd
("cd.lexical_parsing","Lexical analysis and parsing","cd","CS","Lexical analysis, parsing"),
("cd.sdt_runtime","Syntax-directed translation and runtime environments","cd","CS","syntax-directed translation. Runtime environments"),
("cd.icg_dataflow","Intermediate code, local optimisation and data-flow analysis","cd","CS","Intermediate code generation. Local optimisation, Data flow analyses: constant propagation, liveness analysis, common sub expression elimination"),
# os
("os.process","System calls, processes, threads, IPC","os","CS","System calls, processes, threads, inter-process communication"),
("os.sync","Concurrency and synchronization","os","CS","concurrency and synchronization"),
("os.deadlock","Deadlock","os","CS","Deadlock"),
("os.scheduling","CPU and I/O scheduling","os","CS","CPU and I/O scheduling"),
("os.memory","Memory management","os","CS","Memory management"),
("os.vm","Virtual memory","os","CS","virtual memory"),
("os.fs","File systems","os","CS","File systems"),
# net
("net.layering_switching","Layering, switching and performance metrics","net","CS","Principles of Layering; Basics of switching (circuit, packet and virtual circuit) and performance metrics"),
("net.datalink","Data link: error detection, MAC, Ethernet","net","CS","Data link layer: error detection, Medium Access Control, Ethernet"),
("net.routing","Distance vector and link state routing","net","CS","Distance vector and link state routing"),
("net.ipv4","IPv4: fragmentation, CIDR, NAT","net","CS","IPv4 - Fragmentation, CIDR Notation, Network Address Translation"),
("net.transport","TCP flow and congestion control, socket API","net","CS","TCP- flow control and congestion control, socket API"),
("net.app","DNS and HTTP","net","CS","DNS and HTTP"),
# ml
("ml.linreg","Simple and multiple linear regression","ml","DA","simple linear regression, multiple linear regression"),
("ml.ridge","Ridge regression","ml","DA","ridge regression"),
("ml.logreg","Logistic regression","ml","DA","logistic regression"),
("ml.biasvar","Bias-variance trade-off","ml","DA","bias-variance trade-off"),
("ml.cv","Cross-validation: LOO and k-fold","ml","DA","cross-validation methods such as leave-one-out (LOO) cross-validation, k-folds cross-validation"),
("ml.knn","k-nearest neighbour","ml","DA","k-nearest neighbour"),
("ml.nb","Naive Bayes classifier","ml","DA","naive Bayes classifier"),
("ml.lda","Linear discriminant analysis","ml","DA","linear discriminant analysis"),
("ml.svm","Support vector machine","ml","DA","support vector machine"),
("ml.dt","Decision trees","ml","DA","decision trees"),
("ml.mlp","Multi-layer perceptron","ml","DA","multi-layer perceptron"),
("ml.ffnn","Feed-forward neural network","ml","DA","feed-forward neural network"),
("ml.kmeans","Clustering: k-means and k-medoid","ml","DA","clustering algorithms, k-means/k-medoid"),
("ml.hier","Hierarchical clustering (single and multiple linkage)","ml","DA","hierarchical clustering, top-down, bottom-up: single-linkage, multiple-linkage"),
("ml.pca","Dimensionality reduction and PCA","ml","DA","dimensionality reduction, principal component analysis"),
# ai
("ai.uninformed","Uninformed search","ai","DA","Search: uninformed"),
("ai.informed","Informed search","ai","DA","Search: informed"),
("ai.adversarial","Adversarial search","ai","DA","adversarial"),
("ai.logic","Propositional and predicate logic","ai","DA","logic, propositional, predicate"),
("ai.uncertainty","Reasoning under uncertainty: conditional independence, variable elimination, sampling","ai","DA","conditional independence representation, exact inference through variable elimination, and approximate inference through sampling"),
# ga
("ga.verbal","Verbal aptitude","ga","GA","Basic English grammar: tenses, articles, adjectives, prepositions, conjunctions, verb-noun agreement. Basic vocabulary: words, idioms, phrases in context. Reading comprehension, narrative sequencing"),
("ga.quant","Quantitative aptitude","ga","GA","Data interpretation; ratios, percentages, powers, exponents and logarithms, permutations and combinations, series; mensuration and geometry; elementary statistics and probability"),
("ga.analytical","Analytical aptitude","ga","GA","Logic: deduction and induction, Analogy, Numerical relations and reasoning"),
("ga.spatial","Spatial aptitude","ga","GA","Transformation of shapes: translation, rotation, scaling, mirroring, assembling, grouping, paper folding, cutting, patterns in 2D and 3D"),
]
SYL_ROOT = {
 "prob":"DA S1 / CS S1 Probability and Statistics","la":"DA S2 / CS S1 Linear Algebra","calc":"DA S3 / CS S1 Calculus",
 "ds":"CS S4 Programming and Data Structures / DA S4 Programming, DS and Algorithms","algo":"CS S5 Algorithms / DA S4",
 "db":"CS S9 Databases / DA S5 Database Management and Warehousing","dm":"CS S1 Discrete Mathematics","dl":"CS S2 Digital Logic",
 "coa":"CS S3 Computer Organization and Architecture","toc":"CS S6 Theory of Computation","cd":"CS S7 Compiler Design",
 "os":"CS S8 Operating System","net":"CS S10 Computer Networks","ml":"DA S6 Machine Learning","ai":"DA S7 AI","ga":"GA 2027 (15 marks in each paper)"}

GS = "https://www.gatesmashers.com/roadmaps/"
V_ML = {"title":"Gate Smashers - Machine Learning roadmap","url":GS+"machine-learning","lang":"hinglish"}
V_SQ = {"title":"StatQuest video index (pick only named syllabus topics)","url":"https://statquest.org/video_index.html","lang":"en"}
VID_ROOT = {
 "prob":[V_ML], "la":[{"title":"3Blue1Brown - Linear algebra","url":"https://www.3blue1brown.com/topics/linear-algebra","lang":"en"}],
 "ds":[{"title":"Gate Smashers - DSA roadmap","url":GS+"data-structures-and-algorithms","lang":"hinglish"}],
 "algo":[{"title":"Gate Smashers - Design and Analysis of Algorithms roadmap","url":GS+"design-and-analysis-of-algorithms","lang":"hinglish"}],
 "db":[{"title":"Gate Smashers - DBMS + SQL roadmap","url":GS+"dbms-sql","lang":"hinglish"}],
 "coa":[{"title":"Gate Smashers - COA roadmap","url":GS+"computer-organization-architecture","lang":"hinglish"}],
 "os":[{"title":"Gate Smashers - OS roadmap","url":GS+"operating-systems","lang":"hinglish"}],
 "toc":[{"title":"Gate Smashers - TOC roadmap","url":GS+"theory-of-computation","lang":"hinglish"}],
 "cd":[{"title":"Gate Smashers - Compiler Design roadmap","url":GS+"compiler-design","lang":"hinglish"}],
 "net":[{"title":"Gate Smashers - Computer Networks roadmap","url":GS+"computer-networks","lang":"hinglish"}],
 "dl":[{"title":"Gate Smashers - Learn (Boolean algebra, K-map, circuits, arithmetic)","url":"https://www.gatesmashers.com/learn","lang":"hinglish"}],
 "ml":[V_ML],
}
VID_ID = {
 "prob.clt_ci":[V_ML,V_SQ],"prob.tests":[V_ML,V_SQ],"prob.condexp":[V_ML,V_SQ],
 "ml.linreg":[V_ML,{"title":"StatQuest - Linear regression","url":"https://www.youtube.com/watch?v=7ArmBVF2dCs","lang":"en"}],
 "ml.pca":[V_ML,{"title":"StatQuest - PCA and SVD intuition","url":"https://www.youtube.com/watch?v=FgakZw6K1QQ","lang":"en"}],
 "la.svd":[{"title":"StatQuest - PCA and SVD intuition","url":"https://www.youtube.com/watch?v=FgakZw6K1QQ","lang":"en"}],
}
for k in ("ml.ridge","ml.logreg","ml.biasvar","ml.cv","ml.knn","ml.nb","ml.lda","ml.svm","ml.dt","ml.mlp","ml.ffnn","ml.kmeans","ml.hier"):
    VID_ID[k] = [V_ML, V_SQ]
# 04-VIDEOS.md gives no source for: calculus, discrete maths, GA, Python, DA warehouse, AI search/inference.
NO_VIDEO = {"calc","dm","ga","ai"}
NO_VIDEO_IDS = {"ds.python","ds.c","db.transform","db.warehouse","db.hierarchy","la.vecspace","la.proj"}

def build_topics():
    out = []
    for rid, name, paper in ROOTS:
        out.append({"id":rid,"name":name,"parent_id":None,"paper":paper,"syllabus_text":SYL_ROOT[rid],"videos":VID_ROOT.get(rid,[]) if rid not in NO_VIDEO else []})
    for tid, name, parent, paper, syl in L:
        if tid in VID_ID: v = VID_ID[tid]
        elif parent in NO_VIDEO or tid in NO_VIDEO_IDS: v = []
        else: v = VID_ROOT.get(parent, [])
        out.append({"id":tid,"name":name,"parent_id":parent,"paper":paper,"syllabus_text":syl,"videos":v})
    return out

TOPICS = build_topics()
TBY = {t["id"]: t for t in TOPICS}

def subj(tid):
    if tid is None: return "shared"
    p = TBY[tid]["paper"]
    return {"CS":"CS","DA":"DA","shared":"shared","GA":"GA"}[p]

# ---------------------------------------------------------------- helpers
def hm(s): h, m = s.split(":"); return int(h)*60+int(m)
def fmt(mins): return "%02d:%02d" % (mins//60, mins%60)
def tb(start, minutes): return "%s-%s" % (start, fmt(hm(start)+minutes))
def nm(tid): return TBY[tid]["name"]
def task(title, subject, typ, minutes, prio, start=None, topic=None):
    return {"title":title,"subject":subject,"type":typ,"topic_id":topic,"minutes":minutes,"priority":prio,
            "time_block": tb(start, minutes) if start else None}

PHASES = [
 ("p1_habit","Habit-building","2026-10-07","2026-10-16","Light 2-3 h/day study, ramping up. Goal: consistency, diagnostic papers (1 CS + 1 DA), refresh of basics (probability, matrices, C/Python, GA). Job hunt 08:00-10:00 and gym stay fixed."),
 ("p2_puja","Durga Puja break","2026-10-17","2026-10-21","Shashthi 17 Oct to Dashami 21 Oct (Bengal panchang; pan-India Dashami 20 Oct). Minimal load: 15-30 min recall/flashcards only; guilt-free rest."),
 ("p3_reentry","Re-entry ramp","2026-10-22","2026-10-25","Post-Puja ramp: job hunt resumes, 1.5-2.5 h study, set up Week 1 of the full plan."),
 ("p4_full1","Full plan I - shared core + CS foundations","2026-10-26","2026-12-06","Plan weeks 1-6: probability, distributions, linear algebra, calculus, DS, algorithms, DBMS, DA warehouse; first timed sectionals; first CS sectional on Sat 28 Nov. 6-6.5 h/day on weekdays."),
 ("p5_full2","Full plan II - DA ML/AI + CS systems","2026-12-07","2027-01-03","Plan weeks 7-10: regression/classification/clustering/PCA/NN, AI; Digital Logic, COA, OS, Networks start; alternate DA and CS sectionals on Saturdays."),
 ("p6_full3","Full plan III - consolidation + full mocks","2027-01-04","2027-01-31","Plan weeks 11-14: DA syllabus review, finish CS (Networks, TOC, Compiler), weekly (then twice-weekly) full papers, 3 h paper + 2 h analysis, PYQ rotation."),
 ("p7_final","Final taper","2027-02-01","2027-02-05","No new topics. Short timed sets, GA, formula recall, error-log revision, sleep routine; logistics checks."),
 ("p8_exam","Exam window + remaining revision","2027-02-06","2027-02-21","Sat 6 Feb assumed first paper. Remaining exam-weekend days (7, 13-14, 20-21 Feb) and revision for the paper not yet written."),
]
def phase_of(d):
    for pid,_,s,e,_ in PHASES:
        if D(s) <= d <= D(e): return pid
    raise ValueError(d)

# ---------------------------------------------------------------- week definitions (plan weeks 1..14 -> doc weeks)
# mode: learn | review ; sat: (title, subject, exam_min, analysis_min, topics) ; extra papers: dict weekday->(title,subject,topics)
def S(*a): return list(a)
FULL = {
 1:dict(sh=S("prob.counting","prob.axioms","prob.conditional","prob.bayes","ds.python"),
        cs=S("ga.quant","ga.verbal","ga.analytical","ds.c","ds.recursion"),mode="learn",
        sat=("GA diagnostic + shared-basics set (30+ Qs, probability and C/Python basics)","GA",60,60,["ga.quant","prob.bayes"]),
        label="Probability basics, Bayes; Python/C refresh | GA diagnostic"),
 2:dict(sh=S("prob.rv","prob.discrete","prob.continuous","prob.desc","prob.condexp"),
        cs=S("dm.logic","dm.sets_rel","dm.counting","dm.recurrence","dm.graphs"),mode="learn",
        sat=("Timed sectional 1: probability + discrete maths (25 Qs)","shared",75,60,["prob.bayes","prob.discrete","dm.logic"]),
        label="Random variables, distributions, descriptive stats | Discrete maths, counting"),
 3:dict(sh=S("la.vecspace","la.matrices_det","la.systems_rank","la.eigen","la.lu"),
        cs=S("ds.arrays","ds.stacks","ds.queues","ds.linkedlist","dm.algebra"),mode="learn",
        sat=("Timed sectional 2: linear algebra + stacks/queues/lists (25 Qs)","shared",75,60,["la.eigen","ds.stacks"]),
        label="Matrices, systems, eigenvalues, rank | C, arrays, stacks, queues, linked lists"),
 4:dict(sh=S("la.proj","la.svd","calc.limits","calc.taylor","calc.maxmin"),
        cs=S("ds.trees","ds.heaps","algo.hashing","algo.sorting","algo.searching"),mode="learn",
        sat=("Timed sectional 3: LA/calculus + trees, heaps, sorting (30 Qs)","shared",90,75,["la.svd","calc.maxmin","ds.trees"]),
        label="SVD, projections, calculus | Trees, heaps, hashing, sorting, searching"),
 5:dict(sh=S("db.er","db.relalg","db.sql","db.nf","db.index"),
        cs=S("algo.complexity","algo.dnc","ds.graphs","algo.traversal","algo.shortest"),mode="learn",
        sat=("FIRST CS SECTIONAL: Eng Maths + DS + Algorithms + DBMS (CS style, 35 Qs, 2 h)","CS",120,90,["dm.logic","ds.trees","algo.complexity","db.sql"]),
        label="DBMS shared core | Algorithms: complexity, D&C, graphs; first CS sectional"),
 6:dict(sh=S("db.warehouse","db.hierarchy","db.transform","prob.clt_ci","prob.tests"),
        cs=S("algo.greedy","algo.dp","algo.mst","db.txn","db.cc"),mode="learn",
        sat=("DA sectional 1: probability/statistics + LA + DBMS + warehouse (30 Qs, 2 h)","DA",120,90,["prob.tests","la.eigen","db.warehouse"]),
        label="DA warehouse, transformations, statistical inference | Greedy, DP, MST, transactions"),
 7:dict(sh=S("ml.linreg","ml.ridge","ml.logreg","ml.biasvar","ml.cv"),
        cs=S("dl.boolean_min","dl.kmap_tabular","dl.comb","dl.seq","dl.number"),mode="learn",
        sat=("CS sectional 2: Algorithms + DBMS + Digital Logic (35 Qs, 2 h)","CS",120,90,["algo.dp","db.nf","dl.kmap_tabular"]),
        label="DA regression, classification basics, evaluation | Digital Logic"),
 8:dict(sh=S("ml.knn","ml.nb","ml.lda","ml.svm","ml.dt"),
        cs=S("coa.isa","coa.alu","coa.control","coa.memory","coa.pipeline"),mode="learn",
        sat=("DA sectional 2: supervised ML + statistics (30 Qs, 2 h)","DA",120,90,["ml.linreg","ml.svm","prob.tests"]),
        label="DA kNN, NB, LDA, SVM, trees | COA"),
 9:dict(sh=S("ml.mlp","ml.ffnn","ml.kmeans","ml.hier","ml.pca"),
        cs=S("coa.io","os.process","os.scheduling","os.sync","os.deadlock"),mode="learn",
        sat=("CS sectional 3: Digital Logic + COA + OS-so-far (35 Qs, 2 h)","CS",120,90,["dl.comb","coa.memory","os.scheduling"]),
        label="DA neural nets, clustering, PCA | I/O, OS processes/scheduling/sync/deadlock"),
 10:dict(sh=S("ai.uninformed","ai.informed","ai.adversarial","ai.logic","ai.uncertainty"),
        cs=S("os.memory","os.vm","os.fs","net.layering_switching","net.datalink"),mode="learn",
        sat=("DA sectional 3: ML + AI + mixed (30 Qs, 2 h)","DA",120,90,["ml.pca","ai.informed","ai.uncertainty"]),
        label="DA AI search, logic, uncertainty | OS memory/FS; Networks first half"),
 11:dict(sh=S("prob","la","calc","ds","db"),
        cs=S("net.routing","net.ipv4","net.transport","net.app","toc.fa_re"),mode="review",
        sat=("FULL DA PAPER #1 (65 Qs, 3 h)","DA",180,120,["prob","la","ml","ai"]),
        label="DA syllabus review + first full DA paper | Networks second half; TOC automata"),
 12:dict(sh=S("ml","prob","la","ai","db"),
        cs=S("toc.cfg_pda","toc.langs_pumping","toc.tm","cd.lexical_parsing","cd.sdt_runtime"),mode="review",
        sat=("FULL DA PAPER #2 (65 Qs, 3 h)","DA",180,120,["ml","prob","la","ai"]),
        label="DA weak areas + full paper | TOC, Compiler"),
 13:dict(sh=S("prob","ml","la","ai","db"),
        cs=S("cd.icg_dataflow","os","algo","coa","dl"),mode="review",
        sat=("FULL CS PAPER #2 (65 Qs, 3 h)","CS",180,120,["dm","dl","coa","algo","os","toc"]),
        papers={1:("FULL DA PAPER #3 (past paper / question bank, 3 h)","DA",["prob","la","ml","ai"]),
                3:("FULL CS PAPER #1 (past paper, 3 h)","CS",["dm","dl","coa","algo","os","toc"])},
        sun=("FULL DA PAPER #4 (mock equivalent, 3 h)","DA",["prob","la","ml","ai"]),
        label="Two full DA + two full CS papers; analyse every error"),
 14:dict(sh=S("prob","ml","la","db","ai"),cs=S("toc","cd","os","coa","algo"),mode="review",
        sat=("FULL CS PAPER #3 (2017-2026 rotation, 3 h)","CS",180,120,["dm","dl","coa","algo","os","toc","cd","net","db"]),
        sun=("FULL DA PAPER #5 (rotation / mock, 3 h)","DA",["prob","la","ml","ai"]),
        label="Formula recall, mixed sections, 2017-2026 paper rotation"),
}
FULL_START = D("2026-10-26")
def week_start(docw): return FULL_START + timedelta(days=7*(docw-1))

# ---------------------------------------------------------------- build days
days = {}          # date -> tasks
study_log = {}     # date -> topic ids studied (for spaced revision)
ga_cycle = ["ga.verbal","ga.quant","ga.analytical","ga.spatial"]; ga_i = [0]

def add(d, *ts): days.setdefault(d, []).extend(ts)

def spaced_text(d):
    parts = []
    for lag, lab in ((1,"1-day"),(7,"1-week"),(21,"3-week")):
        ids = study_log.get(d - timedelta(days=lag), [])
        ids = [i for i in ids if i in TBY]
        if ids: parts.append("%s: %s" % (lab, ", ".join(nm(i) for i in dict.fromkeys(ids))))
    return "; ".join(parts) if parts else "this week's mistakes"

def job_task(d, minutes=120, title=None):
    return task(title or "Job hunt: 3-5 roles, 2 tailored applications, 2 referral/alumni outreaches, follow-ups, tracker","job","job",minutes,1,"08:00")
def gym_task(): return task("Gym","gym","gym",120,2,"17:00")
def logout(d):
    return [task("Error log + spaced revision (%s)" % spaced_text(d),"shared","revision",15,1,"21:00"),
            task("Check-in: log the day, set tomorrow's three tasks","habit","checkin",15,1,"21:15")]

def pyq_count(mins): return max(1, round(mins/8))

def full_weekday(d, dw, wk):
    i = d.weekday(); wdef = FULL[wk]
    sh, cs = wdef["sh"][i], wdef["cs"][i]
    mode = wdef["mode"]; paper = wdef.get("papers",{}).get(i)
    ts = []
    if i in (0,2,4):
        g = ga_cycle[ga_i[0] % 4]; ga_i[0] += 1
        ts.append(task("GA practice: %s (10-12 Qs) + vocabulary" % nm(g).lower(),"GA","study",30,2,"07:15",g))
    else:
        ts.append(task("Flashcards: due cards + create cards from yesterday's topics","shared","flashcards",30,2,"07:15"))
    ts.append(job_task(d))
    log = []
    if paper:
        t, sj, tops = paper
        ts.append(task(t,sj,"mock",180,1,"10:30",None))
        ts.append(task("Analysis of paper: classify every error (concept/calculation/reading/time/guess), update error log",sj,"revision",120,1,"14:00"))
    elif mode == "learn":
        ts.append(task("Study: %s (max 2 concept videos + 1 worked example, half-page note)" % nm(sh),subj(sh),"study",150,1,"10:30",sh))
        ts.append(task("PYQs: %s (15-20 Qs, log mistakes)" % nm(sh),subj(sh),"pyq",120,2,"14:00",sh))
        log.append(sh)
    else:
        ts.append(task("Review + timed set: %s (60 min timed Qs, 90 min fix gaps)" % nm(sh),subj(sh),"study",150,1,"10:30",sh))
        ts.append(task("Mixed PYQs on weak areas of %s (error-log driven)" % nm(sh),subj(sh),"pyq",120,2,"14:00",sh))
        log.append(sh)
    if i == 4: ts.append(task("Coding-interview practice / small portfolio project (overlaps GATE algorithms where possible)","job","job",45,3,"16:00"))
    ts.append(gym_task())
    verb = "Study" if (cs in TBY and TBY[cs]["parent_id"] is not None and wk <= 12) else "Review"
    ts.append(task("%s: %s (concepts + worked example)" % (verb, nm(cs)),subj(cs),"study",45,1,"19:30",cs))
    ts.append(task("PYQs: %s (CS, 8-10 Qs, log mistakes)" % nm(cs),subj(cs),"pyq",30,2,"20:15",cs))
    log.append(cs)
    study_log[d] = log
    ts += logout(d)
    add(d, *ts)

def full_saturday(d, wk):
    t, sj, m, a, tops = FULL[wk]["sat"]
    ts = [task("Flashcards: weekly deck sweep","shared","flashcards",30,2,"07:15"),
          task(t,sj,"mock",m,1,"09:30")]
    L2 = 330 - 30 - m - a
    if L2 > 0:
        ts.append(task("Catch-up PYQs on this week's topics (error-log driven)","shared","pyq",L2,2,fmt(hm("09:30")+m+15)))
    ts.append(task("Analysis: classify every error, update error log and score sheet",sj,"revision",a,1,"14:00"))
    ts.append(gym_task())
    ts.append(task("Weekend outing / social time (optional, protect rest)","habit","checkin",90,3,"19:30"))
    ts += logout(d)[:1]
    study_log[d] = []
    add(d, *ts)

def full_sunday(d, wk):
    sun = FULL[wk].get("sun")
    if sun:
        t, sj, _ = sun
        ts = [task(t,sj,"mock",180,1,"09:30"),
              task("Analysis of paper: classify every error, update error log and score sheet",sj,"revision",120,1,"14:00")]
    else:
        ts = [task("Mistake review: error log from last 1-3 weeks (1-day / 1-week / 3-week buckets)","shared","revision",60,1,"10:00"),
              task("Weak-topic repair: re-study + PYQs on the 2-3 weakest topics of the week","shared","study",120,2,"11:15"),
              task("SUNDAY BUFFER: overflow tasks from the week, else extra weak-topic PYQs","shared","study",60,3,"14:30")]
    ts.append(task("Weekly review: metrics vs targets, plan next week, flag overflow","habit","checkin",30,1,"16:30"))
    ts.append(task("Job tracker review: which role types respond; adjust resume/targeting","job","job",30,2,"20:00"))
    study_log[d] = []
    add(d, *ts)

# ---- habit phase (explicit)
def H(d, items): add(D(d), *items)
def fl(minutes=20, start="07:15", t="Flashcards: review + create cards"): return task(t,"habit","flashcards",minutes,2,start)
def chk(start="21:00"): return task("Check-in: log the day, set tomorrow's three tasks","habit","checkin",15,1,start)
def jb(): return job_task(None)
def pair(tid, smin, pmin, s1, s2):
    return [task("Study: %s (1-2 videos, half-page note)" % nm(tid),subj(tid),"study",smin,1,s1,tid),
            task("PYQs: %s (10 Qs, log mistakes)" % nm(tid),subj(tid),"pyq",pmin,2,s2,tid)]
def gaT(tid,m=30,start="19:30"): return task("GA practice: %s (10 Qs)" % nm(tid).lower(),"GA","study",m,2,start,tid)

H("2026-10-07",[task("Syllabus walk: skim CS-2027, DA-2027, GA-2027 PDFs; rate confidence 1-5 per section; set up app + flashcard deck","shared","study",45,1,"10:30"),
   jb(),gaT("ga.verbal",30,"19:30"),task("Python refresh: lists, dicts, loops, functions (30 easy problems)","DA","study",45,2,"20:00","ds.python"),gym_task(),chk()])
H("2026-10-08",[fl(20)]+[jb()]+pair("prob.counting",60,30,"10:30","11:45")+[gaT("ga.quant"),gym_task(),chk()])
H("2026-10-09",[fl(20),jb()]+pair("prob.axioms",45,30,"10:30","11:30")+[gaT("ga.analytical"),task("C refresh: pointers, arrays, output tracing (10 snippets)","CS","study",30,2,"20:00","ds.c"),
   task("Coding-interview practice / small portfolio project","job","job",45,3,"16:00"),gym_task(),chk()])
H("2026-10-10",[task("DIAGNOSTIC CS: attempt one recent CS paper (e.g. 2025 CS1) untimed-ish, no score target","CS","mock",90,1,"10:30"),
   task("Diagnostic analysis: list weak sections, tag error types, seed the topic backlog","CS","revision",45,1,"12:00"),
   gaT("ga.spatial",20,"19:30"),gym_task(),task("Mahalaya / weekend: rest, no study","habit","checkin",30,3,"20:00")])
H("2026-10-11",[task("DIAGNOSTIC DA: attempt one DA paper (2025 or 2026) untimed-ish, no score target","DA","mock",90,1,"10:30"),
   task("Diagnostic analysis: list weak sections, tag error types, update topic backlog","DA","revision",45,1,"12:00"),
   task("Weekly review: diagnostic findings -> 4 weak areas; confirm Week 1 plan","habit","checkin",30,1,"16:30"),
   task("Job tracker review","job","job",30,2,"20:00")])
H("2026-10-12",[fl(20),jb()]+pair("prob.conditional",60,30,"10:30","11:45")+[task("Study: C refresh part 2 - recursion basics (1 worked example, 8 snippets)","CS","study",45,1,"19:30","ds.c"),gym_task()]+logout(D("2026-10-12")))
H("2026-10-13",[fl(20),jb()]+pair("prob.bayes",60,30,"10:30","11:45")+[task("Study: Propositional logic basics (truth tables, equivalences)","CS","study",45,1,"19:30","dm.logic"),gaT("ga.verbal",20,"20:15"),gym_task()]+logout(D("2026-10-13")))
H("2026-10-14",[fl(20),jb()]+pair("la.matrices_det",60,30,"10:30","11:45")+[task("Study: Recursion tracing (factorial, fibonacci, call stack)","CS","study",45,1,"19:30","ds.recursion"),gaT("ga.quant",30,"20:15"),gym_task()]+logout(D("2026-10-14")))
H("2026-10-15",[fl(20),jb()]+pair("la.eigen",60,30,"10:30","11:45")+[task("Study: Stacks and queues basics","CS","study",45,1,"19:30","ds.stacks"),gaT("ga.analytical",30,"20:15"),gym_task()]+logout(D("2026-10-15")))
H("2026-10-16",[fl(20),jb()]+pair("ds.python",60,30,"10:30","11:45")+[task("Study: Counting basics (permutation/combination recap)","CS","study",45,1,"19:30","dm.counting"),gaT("ga.spatial",30,"20:15"),
   task("Coding-interview practice / small portfolio project","job","job",45,3,"16:00"),gym_task()]+logout(D("2026-10-16")))
for dd in ("2026-10-07","2026-10-08","2026-10-09","2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16"):
    pass
habit_logs = {"2026-10-07":[],"2026-10-08":["prob.counting"],"2026-10-09":["prob.axioms","ds.c"],"2026-10-12":["prob.conditional","ds.c"],
  "2026-10-13":["prob.bayes","dm.logic"],"2026-10-14":["la.matrices_det","ds.recursion"],"2026-10-15":["la.eigen","ds.stacks"],"2026-10-16":["ds.python","dm.counting"]}
for k,v in habit_logs.items(): study_log[D(k)] = v

# ---- Puja
PJ = {"2026-10-17":("Shashthi",20),"2026-10-18":("Saptami",15),"2026-10-19":("Ashtami",30),"2026-10-20":("Navami",20),"2026-10-21":("Dashami / Bijoya (Bengal)",20)}
for k,(nmx,m) in PJ.items():
    d = D(k)
    ts = [task("Puja %s: light recall - flashcards only (Bayes, eigenvalues, counting, recursion)" % nmx,"habit","flashcards",m,1,"10:00")]
    if d.weekday() < 5: ts.append(task("Job tracker + follow-ups only (light day)","job","job",30,2,"08:00"))
    ts.append(task("Enjoy the festival: no study beyond the recall above","habit","checkin",15,3,"21:00"))
    add(d,*ts)
# ---- Re-entry
d=D("2026-10-22"); add(d,fl(20),job_task(d),
  task("Re-entry: error-log review of diagnostics + habit-phase mistakes","shared","revision",45,1,"10:30"),
  task("Light PYQs: Bayes + eigenvalues (10 Qs)","shared","pyq",45,2,"11:30","prob.bayes"),gym_task(),chk())
d=D("2026-10-23"); add(d,fl(20),job_task(d),
  task("Refresh: C pointers + recursion (1 worked example each)","CS","study",60,1,"10:30","ds.c"),
  task("PYQs: probability mixed (15 Qs)","shared","pyq",45,2,"14:00","prob.conditional"),
  task("GA practice: verbal 10 Qs","GA","study",30,2,"19:30","ga.verbal"),
  task("Coding-interview practice / small portfolio project","job","job",45,3,"16:00"),gym_task(),chk())
d=D("2026-10-24"); add(d,fl(20),task("Mini sectional: shared basics (probability, LA, recursion; 20 Qs)","shared","mock",60,1,"09:30"),
  task("Analysis + error log","shared","revision",45,1,"10:45"),
  task("Set up Week 1 of the full plan: skim video links, stock flashcards, tidy desk","habit","study",30,2,"11:45"),gym_task(),
  task("Weekend outing (optional)","habit","checkin",90,3,"19:30"))
d=D("2026-10-25"); add(d,task("Mistake review: all errors from diagnostics + mini sectional","shared","revision",60,1,"10:00"),
  task("Preview Week 1: probability counting/axioms/conditional/Bayes + GA diagnostic set; align sleep to 23:00-06:30","shared","study",45,2,"11:15"),
  task("Weekly review + plan Week 1 (full plan starts Mon 26 Oct)","habit","checkin",30,1,"16:30"),task("Job tracker review","job","job",30,2,"20:00"))
study_log[D("2026-10-22")]=["prob.bayes"]; study_log[D("2026-10-23")]=["ds.c","prob.conditional"]

# ---- full plan weeks
for wk in range(1,15):
    ws = week_start(wk)
    for k in range(7):
        d = ws + timedelta(days=k)
        if k < 5: full_weekday(d, k, wk)
        elif k == 5: full_saturday(d, wk)
        else: full_sunday(d, wk)

# ---- final taper 1-5 Feb
FIN = {
 "2027-02-01":("Timed mixed CS set (60 Qs mix, 2 h) from 2017-2026 papers you have not seen","CS","mock",120,["dm","dl","coa","algo","os","toc"]),
 "2027-02-02":("Timed mixed DA set (60 Qs mix, 2 h)","DA","mock",120,["prob","la","ml","ai"]),
}
for k,(t,sj,ty,m,_) in FIN.items():
    d=D(k)
    add(d,fl(30,"07:15","Flashcards: full sweep of formulas and error-log cards"),job_task(d),
        task(t,sj,"mock",m,1,"10:30"),task("Analysis: only fix recurring error types (no new topics)",sj,"revision",90,1,"14:00"),gym_task(),
        task("GA practice: 15 mixed Qs, timed","GA","study",45,2,"19:30","ga.quant"),*logout(d))
    study_log[d]=[]
d=D("2027-02-03"); add(d,fl(30,"07:15","Flashcards: formulas, CS+DA"),job_task(d,60,"Job hunt: light (follow-ups only)"),
    task("Formula and concept recall: DA (probability, LA, ML, AI) from memory sheets","DA","revision",90,1,"10:30"),
    task("Formula and concept recall: CS (algorithms, OS, COA, DL, TOC) from memory sheets","CS","revision",90,1,"14:00"),gym_task(),
    task("GA: one timed set (10 Qs)","GA","study",30,2,"19:30","ga.verbal"),*logout(d))
d=D("2027-02-04"); add(d,fl(30,"07:15","Flashcards: weakest 100 cards"),job_task(d,60,"Job hunt: light (follow-ups only)"),
    task("Error-log revision: top 20 repeated mistakes, both papers","shared","revision",90,1,"10:30"),
    task("Light PYQs: 10 favourite topics (confidence builders)","shared","pyq",60,2,"14:00"),
    task("Gym (light)","gym","gym",60,2,"17:00"),
    task("Logistics: admit card, ID, centre route, calculator-free kit, bag; sleep by 22:30","habit","checkin",30,1,"19:30"),*logout(d))
d=D("2027-02-05"); add(d,fl(20,"07:15","Flashcards: light sweep"),
    task("Light revision: error log and formula sheet only, stop by 16:00","shared","revision",90,1,"10:30"),
    task("Final logistics check; relax; early dinner; sleep by 22:00 (target 7-8 h)","habit","checkin",60,1,"18:00"))
for k in ("2027-02-03","2027-02-04","2027-02-05"): study_log[D(k)]=[]
# ---- exam window
add(D("2027-02-06"),task("EXAM DAY (assumed first paper): wake early, reach centre in time; no study","habit","checkin",60,1,None))
add(D("2027-02-07"),task("Exam day if your second paper is today (else rest day); post-exam notes: what was asked","habit","checkin",60,1,None),
    task("If no paper today: 45 min light revision for the remaining paper","shared","revision",45,2,"11:00"))
for k in range(8,13):
    d=D("2027-02-%02d"%k)
    add(d,job_task(d),task("Remaining-paper revision: timed PYQ set (set paper to CS or DA once your session is known)","shared","revision",90,1,"10:30"),
        task("Remaining-paper revision: error log + formula recall","shared","revision",75,1,"14:00"),gym_task(),
        task("Check-in: confirm the next exam date from admit card","habit","checkin",15,1,"21:00"))
for k in (13,14,20,21):
    d=D("2027-02-%02d"%k)
    add(d,task("Exam day if a paper is scheduled today (per admit card); else rest","habit","checkin",60,1,None),
        task("If no paper today: 45 min light revision for the remaining paper","shared","revision",45,2,"11:00"))
for k in range(15,20):
    d=D("2027-02-%02d"%k)
    add(d,job_task(d),task("Remaining-paper revision (only if a paper is still pending; else full rest and job focus)","shared","revision",90,2,"10:30"),gym_task(),
        task("Check-in","habit","checkin",15,1,"21:00"))
# fix None-date jobs (habit helper jb() unused)
for d,ts in days.items():
    for t in ts: assert t["time_block"] is None or re.fullmatch(r"\d\d:\d\d-\d\d:\d\d",t["time_block"])

for _d in days: days[_d].sort(key=lambda t:(t["time_block"] is None, t["time_block"] or ""))
# ---------------------------------------------------------------- weeks
def week_ranges():
    r=[(D("2026-10-07"),D("2026-10-11")),(D("2026-10-12"),D("2026-10-18")),(D("2026-10-19"),D("2026-10-25"))]
    for w in range(1,15):
        s=week_start(w); r.append((s,s+timedelta(days=6)))
    r += [(D("2027-02-01"),D("2027-02-07")),(D("2027-02-08"),D("2027-02-14")),(D("2027-02-15"),D("2027-02-21"))]
    return r
WR = week_ranges()
COUNT_TYPES = {"study","pyq","revision","mock","flashcards"}
def wk_stats(s,e):
    pyq=fc=mk=0
    d=s
    while d<=e:
        for t in days[d]:
            if t["type"]=="pyq": pyq+=pyq_count(t["minutes"])
            if t["type"]=="flashcards": fc+=t["minutes"]*2
            if t["type"]=="mock": mk+=1
        d+=timedelta(days=1)
    return pyq,fc,mk
def r5(x): return int(5*round(x/5))
manual = {
 1:("Habit start (Wed-Sun)",[("Study something on all 5 days (consistency streak)","study_days",5),("Complete both diagnostics (1 CS + 1 DA paper), analysed","diagnostic_papers",2),("Build first flashcard deck from diagnostics and basics","flashcards_created",40),("Job applications sent (2/weekday)","applications_sent",6)],["prob.counting","prob.axioms"],["ds.c","dm.logic"]),
 2:("Habit ramp (Mon-Fri study, Puja starts Sat)",[("Study at least 5 of 5 weekdays, 2.5-3 h","study_days",5),("Basics refreshed: conditional, Bayes, determinants, eigenvalues, Python","topics_completed",5),("PYQs solved on refreshed basics","pyqs_solved",50),("Job applications sent","applications_sent",10)],["prob.conditional","prob.bayes","la.matrices_det","la.eigen","ds.python"],["ds.c","dm.logic","ds.recursion","ds.stacks","dm.counting"]),
 3:("Puja + re-entry",[("Daily recall 15-30 min during Puja (17-21 Oct)","recall_days",5),("Resume job block 08:00-10:00 from Thu 22 Oct","job_days_resumed",4),("Mini sectional on shared basics (20 Qs) and mistake review","mocks_taken",1),("Week 1 materials set up before Mon 26 Oct","setup_done",1)],["prob.bayes"],["ds.c"]),
 18:("Final taper + exam weekend",[("Two timed mixed sets (CS, DA) + analysis, no new topics","mocks_taken",2),("Flashcards and formula sheets swept","flashcards_reviewed",150),("Sleep >=7 h on the 3 nights before exam","sleep_nights",3),("Sat 6 Feb: first paper (assumed)","exam_days",1)],[],[]),
 19:("Post-exam revision for remaining paper",[("Daily 2-3 h revision only if a paper is pending (weekday blocks 8-12 Feb)","revision_days",5),("Confirm remaining exam date(s) from admit card","admit_card_checked",1)],[],[]),
 20:("Remaining exam window",[("Light revision (<=1.5 h) before remaining paper dates","revision_days",5),("Job hunt continues; protect sleep","applications_sent",10)],[],[]),
}
weeks=[]
doc_of={}
for wi,(s,e) in enumerate(WR, start=1):
    wno = wi
    dw = wi-3 if 4<=wi<=17 else None
    if wi in manual:
        label,goals,sh,cs = manual[wi]
        mg=[{"text":a,"metric":b,"target":c} for a,b,c in goals]
    else:
        W=FULL[dw]; label=W["label"]; sh=W["sh"]; cs=W["cs"]
        pyq,fc,mk=wk_stats(s,e)
        learn = W["mode"]=="learn"
        ntop = len(set(sh)|set(cs)) if learn else len(set(sh)|set(cs))
        mg=[{"text":("Complete %d topics (study + PYQs + half-page note each)" if learn else "Review %d sections/topics with timed sets and gap fixes") % ntop,"metric":"topics_completed","target":ntop},
            {"text":"Solve PYQs / topic questions (weekday blocks + Sunday repair)","metric":"pyqs_solved","target":r5(pyq)},
            {"text":"Timed tests this week: %s" % (W["sat"][0] if "papers" not in W else "4 full papers (2 DA + 2 CS)"),"metric":"mocks_taken","target":mk},
            {"text":"Flashcards reviewed (daily 30 min Tue/Thu/Sat; new cards from each topic)","metric":"flashcards_reviewed","target":r5(fc)},
            {"text":"Error-log entries with cause tag; 1-day/1-week/3-week reviews done","metric":"error_log_entries","target":20},
            {"text":"Job applications sent (2 per weekday) + 10 referral/outreach messages","metric":"applications_sent","target":10}]
    weeks.append({"week_no":wno,"doc_week":dw,"label":label,"start":s.isoformat(),"end":e.isoformat(),"phase_id":phase_of(s),
                  "macro_goals":mg,"focus":{"shared_da":[x for x in sh if x],"cs":[x for x in cs if x]}})

# ---------------------------------------------------------------- output + validation
plan = {"meta":{"generated_for":"2026-10-06","assumptions":{"puja":"Shashthi 17 Oct to Dashami 21 Oct 2026 (Bengal panchang)","first_paper":"2027-02-06","full_plan_start":"2026-10-26","gym":"17:00-19:00 Mon-Sat (configurable; skipped on Sunday and during Puja)","job":"08:00-10:00 weekdays (configurable)","sleep_min_hours":6}},
 "phases":[{"id":a,"name":b,"start":c,"end":d_,"description":e} for a,b,c,d_,e in PHASES],
 "weeks":weeks,
 "days":[{"date":d.isoformat(),"tasks":days[d]} for d in sorted(days)]}
all_days=[START+timedelta(days=i) for i in range((END-START).days+1)]
missing=[d for d in all_days if d not in days]
assert not missing, missing
assert len(days)==len(all_days)
for wkk in weeks:
    for k in ("shared_da","cs"):
        for x in wkk["focus"][k]: assert x in TBY, x
for d,ts in days.items():
    for t in ts:
        assert t["topic_id"] is None or t["topic_id"] in TBY,(d,t)
        assert t["subject"] in ("CS","DA","shared","GA","job","gym","habit")
        assert t["type"] in ("study","pyq","revision","mock","flashcards","job","gym","checkin")
        assert t["priority"] in (1,2,3)
# week coverage
cov=set()
for wkk in weeks:
    d=D(wkk["start"])
    while d<=D(wkk["end"]): cov.add(d); d+=timedelta(days=1)
assert cov==set(all_days)
tp = TBY
assert len({t["id"] for t in TOPICS})==len(TOPICS)
for t in TOPICS: assert t["parent_id"] is None or t["parent_id"] in tp

json.dump(TOPICS,open(os.path.join(HERE,"..","..","seed","topics.json"),"w"),indent=1,ensure_ascii=False)
json.dump(plan,open(os.path.join(HERE,"plan.json"),"w"),indent=1,ensure_ascii=False)

# hours by subject
hrs={}
for d,ts in days.items():
    for t in ts:
        hrs[t["subject"]]=hrs.get(t["subject"],0)+t["minutes"]
study_hrs={}
for d,ts in days.items():
    for t in ts:
        if t["type"] in COUNT_TYPES: study_hrs[t["subject"]]=study_hrs.get(t["subject"],0)+t["minutes"]
phase_hrs={}
for d,ts in days.items():
    p=phase_of(d)
    phase_hrs[p]=phase_hrs.get(p,0)+sum(t["minutes"] for t in ts if t["type"] in COUNT_TYPES)
print("days:",len(days),"topics:",len(TOPICS),"leaf topics:",len(L))
print("study hours by subject:",{k:round(v/60,1) for k,v in study_hrs.items()}, "total", round(sum(study_hrs.values())/60,1))
print("all-task hours by subject:",{k:round(v/60,1) for k,v in hrs.items()})
print("study hours by phase:",{k:round(v/60,1) for k,v in phase_hrs.items()})

# weekly table into spec
rows=["| Wk | Dates | Phase | Plan wk | Focus (shared/DA | CS) | Pyqs | Mocks | Flashcards |","|---|---|---|---|---|---|---|---|---|"]
for w in weeks:
    pyq,fc,mk=wk_stats(D(w["start"]),D(w["end"]))
    f="%s | %s" % (", ".join(w["focus"]["shared_da"]) or "-",", ".join(w["focus"]["cs"]) or "-")
    rows.append("| %d | %s to %s | %s | %s | %s | %d | %d | %d |" % (w["week_no"],w["start"],w["end"],w["phase_id"],w["doc_week"] or "-",f,r5(pyq),mk,r5(fc)))
tbl="\n".join(rows)
if os.path.exists(SPEC):
    s=open(SPEC).read()
    s=re.sub(r"<!-- WEEKS_TABLE_START -->.*<!-- WEEKS_TABLE_END -->","<!-- WEEKS_TABLE_START -->\n"+tbl.replace("\\","\\\\")+"\n<!-- WEEKS_TABLE_END -->",s,flags=re.S)
    open(SPEC,"w").write(s)
