from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


OUT = Path("output/pdf/GATE-2027-CS-DA-print-checklist.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
pdfmetrics.registerFont(TTFont("Arial", FONT_PATH))
pdfmetrics.registerFont(TTFont("Arial-Bold", BOLD_PATH))

SECTIONS = [
    ("General Aptitude", "COMMON GA", [
        "Grammar: tenses, articles, adjectives and prepositions",
        "Grammar: conjunctions, verb-noun agreement, other parts of speech",
        "Vocabulary: words, idioms and phrases in context",
        "Reading comprehension and narrative sequencing",
        "Data interpretation: bar/pie/other graphs, 2D and 3D plots",
        "Data interpretation: maps and tables",
        "Numerical computation/estimation: ratios, percentages, powers, exponents, logs",
        "Numerical computation: permutations, combinations and series",
        "Mensuration, geometry, elementary statistics and probability",
        "Logic: deduction and induction; analogy",
        "Numerical relations and reasoning",
        "Spatial: translation, rotation, scaling and mirroring",
        "Spatial: assembling, grouping, paper folding and cutting",
        "Spatial: patterns in 2D and 3D",
    ]),
    ("Discrete Mathematics", "FOLLOW CS", [
        "Propositional and first-order logic",
        "Sets, relations and functions",
        "Partial orders and lattices",
        "Monoids and groups",
        "Graphs: connectivity, matching and colouring",
        "Combinatorics: counting, recurrence relations, generating functions",
    ]),
    ("Probability and Statistics", "FOLLOW DA", [
        "Counting: permutations and combinations",
        "Probability axioms, sample space and events",
        "Independent and mutually exclusive events",
        "Marginal, conditional and joint probability; Bayes' theorem",
        "Conditional expectation and variance",
        "Mean, median, mode and standard deviation",
        "Correlation and covariance",
        "Random variables; discrete RVs and probability mass functions",
        "Uniform, Bernoulli and binomial distributions",
        "Continuous RVs, probability density and cumulative functions",
        "Uniform, exponential, Poisson and normal distributions",
        "Standard normal, t and chi-squared distributions",
        "Conditional PDF and central limit theorem",
        "Confidence intervals; z-test, t-test and chi-squared test",
    ]),
    ("Linear Algebra", "FOLLOW DA", [
        "Vector spaces and subspaces",
        "Linear dependence and independence of vectors",
        "Matrices: projection, orthogonal, idempotent, partition; properties",
        "Quadratic forms",
        "Systems of linear equations and their solutions; Gaussian elimination",
        "Eigenvalues and eigenvectors",
        "Determinants, rank, nullity and projections",
        "LU decomposition and singular value decomposition (SVD)",
    ]),
    ("Calculus and Optimization", "CS CORE + DA ADDITION", [
        "Single-variable functions; limits, continuity, differentiability",
        "Maxima, minima and single-variable optimization",
        "Mean value theorem [CS]",
        "Integration [CS]",
        "Taylor series [DA]",
    ]),
    ("Programming and Data Structures", "CS CORE + PYTHON", [
        "Programming in C [CS]",
        "Programming in Python [DA]",
        "Recursion and arrays [CS]",
        "Stacks, queues and linked lists",
        "Trees and binary search trees [CS depth]",
        "Binary heaps [CS]",
        "Graphs [CS] and hash tables [DA]",
    ]),
    ("Algorithms", "FOLLOW CS + DA NAMED SORTS", [
        "Linear and binary search [DA]; searching generally [CS]",
        "Hashing [CS]",
        "Selection, bubble and insertion sort [DA]",
        "Merge sort and quicksort [DA]; sorting generally [CS]",
        "Asymptotic worst-case time and space complexity [CS]",
        "Divide and conquer; greedy algorithms; dynamic programming [CS]",
        "Introduction to graph theory [DA] and graph traversals",
        "Shortest paths and minimum spanning trees [CS]",
    ]),
    ("Databases and Data Warehousing", "CS CORE + DA ADDITIONS", [
        "ER model and relational model",
        "Relational algebra and tuple calculus",
        "SQL and integrity constraints",
        "Normal forms",
        "File organization and indexing",
        "B and B+ tree indexes [CS]",
        "Transactions and concurrency control [CS]",
        "Data types [DA]",
        "Data transformation: normalization and discretization [DA]",
        "Data transformation: sampling and compression [DA]",
        "Warehouse: multidimensional data model schemas [DA]",
        "Warehouse: concept hierarchies [DA]",
        "Warehouse measures: categorization and computations [DA]",
    ]),
    ("Digital Logic", "FOLLOW CS", [
        "Boolean algebra and algebraic minimization",
        "Karnaugh-map and tabular minimization",
        "Combinational and sequential circuit design",
        "Number representation; fixed- and floating-point arithmetic",
    ]),
    ("Computer Organization and Architecture", "FOLLOW CS", [
        "Instruction sets and addressing modes",
        "Arithmetic and logic unit (ALU) design",
        "Hardwired and microprogrammed control unit design",
        "Memory interfacing and hierarchy; performance",
        "Cache memory mapping",
        "I/O interface: interrupts and DMA",
        "Instruction pipelining and pipeline hazards",
    ]),
    ("Theory of Computation", "FOLLOW CS", [
        "Regular expressions and finite automata",
        "Context-free grammars and push-down automata",
        "Regular and context-free languages",
        "Pumping lemma",
        "Turing machines and undecidability",
    ]),
    ("Compiler Design", "FOLLOW CS", [
        "Lexical analysis and parsing",
        "Syntax-directed translation",
        "Runtime environments and intermediate code generation",
        "Local optimisation",
        "Data-flow analysis: constant propagation and liveness",
        "Data-flow analysis: common subexpression elimination",
    ]),
    ("Operating Systems", "FOLLOW CS", [
        "System calls, processes and threads",
        "Inter-process communication",
        "Concurrency and synchronization",
        "Deadlock",
        "CPU and I/O scheduling",
        "Memory management and virtual memory",
        "File systems",
    ]),
    ("Computer Networks", "FOLLOW CS", [
        "Principles of layering",
        "Circuit, packet and virtual-circuit switching; performance metrics",
        "Data link layer: error detection",
        "Medium access control and Ethernet",
        "Distance-vector and link-state routing",
        "IPv4 fragmentation, CIDR notation and NAT",
        "TCP flow and congestion control; socket API",
        "DNS and HTTP",
    ]),
    ("Machine Learning", "FOLLOW DA", [
        "Supervised learning: regression and classification problems",
        "Simple and multiple linear regression; ridge regression",
        "Logistic regression and k-nearest neighbour",
        "Naive Bayes and linear discriminant analysis",
        "Support vector machines and decision trees",
        "Bias-variance trade-off",
        "Leave-one-out and k-fold cross-validation",
        "Multilayer perceptron and feed-forward neural network",
        "Unsupervised learning: clustering algorithms",
        "k-means and k-medoids",
        "Hierarchical clustering: top-down and bottom-up",
        "Single-linkage and multiple-linkage clustering",
        "Dimensionality reduction and principal component analysis (PCA)",
    ]),
    ("Artificial Intelligence", "FOLLOW DA", [
        "Search: uninformed, informed and adversarial",
        "Propositional and predicate logic",
        "Uncertainty: conditional independence representation",
        "Exact inference through variable elimination",
        "Approximate inference through sampling",
    ]),
]

PAGE_W, PAGE_H = A4
LEFT = 24
RIGHT = PAGE_W - 24
TOP = PAGE_H - 25
BOTTOM = 25
COL = [LEFT, LEFT + 270, LEFT + 300, LEFT + 330, LEFT + 364,
       LEFT + 398, LEFT + 428, RIGHT]
SECTION_H = 21

c = canvas.Canvas(str(OUT), pagesize=(PAGE_W, PAGE_H))
c.setTitle("GATE 2027 CS + DA Printable Syllabus Checklist")
c.setAuthor("GATE 2027 CS + DA Study Project")
page_no = 0
y = 0
current_title = ""
current_lead = ""


def line_text(text, x, y, font="Arial", size=8.6, color=colors.black):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, text)


def page_start():
    global page_no, y
    if page_no:
        c.showPage()
    page_no += 1
    line_text("GATE 2027  |  CS + DA CHECKLIST", LEFT, TOP - 14,
              "Arial-Bold", 11)
    line_text(f"{page_no}", RIGHT - 10, TOP - 14, "Arial", 9)
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.7)
    c.line(LEFT, TOP - 21, RIGHT, TOP - 21)
    y = TOP - 28
    heads = [("TOPIC", COL[0] + 5), ("DONE", COL[1] + 3),
             ("PYQ", COL[2] + 6), ("REV 1", COL[3] + 5),
             ("REV 2", COL[4] + 5), ("TEST", COL[5] + 4),
             ("NOTE / PHASE", COL[6] + 5)]
    for label, x in heads:
        line_text(label, x, y - 12, "Arial-Bold", 7.6)
    c.setLineWidth(0.5)
    c.line(LEFT, y - 18, RIGHT, y - 18)
    y -= 18


def wrapped_lines(label, size=8.4):
    limit = COL[1] - COL[0] - 10
    result = []
    current = ""
    for word in label.split():
        candidate = f"{current} {word}" if current else word
        if current and pdfmetrics.stringWidth(candidate, "Arial", size) > limit:
            result.append(current)
            current = word
        else:
            current = candidate
    if current:
        result.append(current)
    return result


def row_height(label):
    return 18 + 10 * max(1, len(wrapped_lines(label)))


def section_header(title, lead):
    global y
    if y - SECTION_H - 28 < BOTTOM:
        page_start()
    tag = "GA" if lead == "COMMON GA" else (
        "CS" if lead == "FOLLOW CS" else (
            "DA" if lead == "FOLLOW DA" else "CS + DA"))
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.6)
    c.line(LEFT, y, RIGHT, y)
    c.line(LEFT, y - SECTION_H, RIGHT, y - SECTION_H)
    line_text(title.upper(), LEFT + 5, y - 14.5, "Arial-Bold", 9.2)
    tag_width = pdfmetrics.stringWidth(tag, "Arial-Bold", 8)
    line_text(tag, RIGHT - 5 - tag_width, y - 14.5, "Arial-Bold", 8)
    y -= SECTION_H


def row(label):
    global y
    lines = wrapped_lines(label)
    height = row_height(label)
    if y - height < BOTTOM:
        page_start()
        section_header(current_title + " (CONTINUED)", current_lead)
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.3)
    c.line(LEFT, y - height, RIGHT, y - height)
    for x in COL[1:-1]:
        c.line(x, y, x, y - height)
    first_baseline = y - (height - (len(lines) - 1) * 10) / 2 - 3
    for index, text_line in enumerate(lines):
        line_text(text_line, LEFT + 5, first_baseline - index * 10, size=8.4)
    for i in range(1, 6):
        cx = (COL[i] + COL[i + 1]) / 2
        c.rect(cx - 5, y - height / 2 - 5, 10, 10, fill=0, stroke=1)
    y -= height


page_start()
for title, lead, items in SECTIONS:
    current_title = title
    current_lead = lead
    if title == "Artificial Intelligence" and y - SECTION_H - sum(row_height(item) for item in items) < BOTTOM:
        page_start()
    section_header(title, lead)
    for item in items:
        row(item)

phase_h = 21 + 20 + 4 * 52
if y - phase_h - 15 < BOTTOM:
    page_start()
y -= 15
c.setStrokeColor(colors.black)
c.setLineWidth(0.6)
c.line(LEFT, y, RIGHT, y)
c.line(LEFT, y - 21, RIGHT, y - 21)
line_text("PHASE REVIEW", LEFT + 5, y - 14, "Arial-Bold", 9.2)
y -= 21
phase_cols = [LEFT, LEFT + 92, LEFT + 244, LEFT + 387, RIGHT]
for label, x in [("PHASE / DATES", phase_cols[0] + 5),
                 ("DONE + PYQS", phase_cols[1] + 5),
                 ("NEEDS REVISION", phase_cols[2] + 5),
                 ("NEXT PRIORITY", phase_cols[3] + 5)]:
    line_text(label, x, y - 13, "Arial-Bold", 7.5)
c.line(LEFT, y - 20, RIGHT, y - 20)
y -= 20
for _ in range(4):
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.3)
    c.line(LEFT, y - 52, RIGHT, y - 52)
    for x in phase_cols[1:-1]:
        c.line(x, y, x, y - 52)
    y -= 52

c.showPage()
page_no += 1
line_text("FULL MOCK TEST LOG", LEFT, TOP - 16, "Arial-Bold", 12)
line_text(f"{page_no}", RIGHT - 10, TOP - 16, "Arial", 9)
c.setStrokeColor(colors.black)
c.setLineWidth(0.7)
c.line(LEFT, TOP - 23, RIGHT, TOP - 23)
mock_cols = [LEFT, LEFT + 25, LEFT + 85, LEFT + 130, LEFT + 180,
             LEFT + 318, RIGHT - 61, RIGHT]
mock_y = TOP - 33
for text_, i in [("#", 0), ("DATE", 1), ("PAPER", 2), ("SCORE", 3),
                 ("WEAK AREAS", 4), ("NEXT FIX", 5),
                 ("REVIEWED", 6)]:
    line_text(text_, mock_cols[i] + 5, mock_y - 15, "Arial-Bold", 7.8)
c.line(LEFT, mock_y - 22, RIGHT, mock_y - 22)
mock_y -= 22
for number in range(1, 13):
    h = 50
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.3)
    c.line(LEFT, mock_y - h, RIGHT, mock_y - h)
    for x in mock_cols[1:-1]:
        c.line(x, mock_y, x, mock_y - h)
    line_text(str(number), LEFT + 8, mock_y - h / 2 - 3, size=9)
    c.rect((mock_cols[-2] + mock_cols[-1]) / 2 - 5,
           mock_y - h / 2 - 5, 10, 10, fill=0, stroke=1)
    mock_y -= h

c.save()
print(f"Wrote {OUT} | syllabus sections: {len(SECTIONS)} | subtopics: {sum(len(s[2]) for s in SECTIONS)} | pages: {page_no}")
