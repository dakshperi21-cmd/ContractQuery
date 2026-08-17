// Shared glossary data — used by app.js (ELI5 inline explanations) and
// glossary.html (the full browsable glossary page). Plain global, no
// build step, so both pages can just <script src="/glossary-data.js">
// before their own script and use window.GLOSSARY / window.CONCEPTS.

window.CONCEPTS = {
  "supply-demand": {
    label: "Supply & Demand",
    blurb: "When more people want to buy than sell, price goes up. When more want to sell than buy, price goes down. Every number on this page is a snapshot of that tug-of-war.",
  },
  "risk-reward": {
    label: "Risk vs. Reward",
    blurb: "A bet that pays off big usually has a smaller chance of paying off at all. Cheap contracts can pay huge multiples — precisely because they're expected to lose most of the time.",
  },
  "opportunity-cost": {
    label: "Opportunity Cost",
    blurb: "Every dollar you put into one contract is a dollar you can't use somewhere else. The \"cost\" of a choice isn't just its price — it's the next-best thing you gave up to make it.",
  },
  "info-aggregation": {
    label: "How Prices Aggregate Information",
    blurb: "Thousands of people trading on whatever they each individually know gets pooled into a single number: the price. That's often faster and harder to fool than any one news source.",
  },
};

window.GLOSSARY = [
  {
    id: "implied-probability",
    term: "Implied probability",
    definition: "The price of a \"Yes\" share, read as a percent chance of that thing happening. A contract trading at 30¢ is the market saying \"about 30% likely.\"",
    analogy: "Like a raffle ticket that pays $1 if you win. If tickets cost 30¢, buyers are implicitly betting there's roughly a 30% chance of winning — otherwise the ticket's a bad deal and nobody would buy it at that price.",
    concept: "info-aggregation",
  },
  {
    id: "liquidity",
    term: "Liquidity",
    definition: "How easily you can buy or sell a contract without moving its price much.",
    analogy: "A packed restaurant with 40 tables (high liquidity) vs. a pop-up with 2 seats (low liquidity). In the busy one you can get a table near the listed price any time; in the tiny one, a big group might have to pay way more — or simply can't get in at all.",
    concept: "supply-demand",
  },
  {
    id: "volume",
    term: "Volume",
    definition: "The total dollar amount that's changed hands on a contract — often shown for the last 24 hours and all-time.",
    analogy: "How much cash moved through a store's register today. A busy store isn't always the one with the best prices, but you know a lot of people are actively engaging with it right now.",
    concept: "supply-demand",
  },
  {
    id: "spread",
    term: "Spread",
    definition: "The gap between the highest price a buyer will currently pay (the bid) and the lowest price a seller will accept (the ask).",
    analogy: "Haggling at a flea market: the seller wants $20, the buyer offers $15 — that $5 gap is the spread. A huge gap means it's hard for the two sides to agree on a fair trade right now.",
    concept: "risk-reward",
  },
  {
    id: "bid-ask",
    term: "Bid / Ask",
    definition: "The bid is the highest price someone is currently offering to pay. The ask is the lowest price someone is currently willing to sell for.",
    analogy: "Like a used-car listing: the buyer's best offer is the bid, the seller's lowest acceptable price is the ask. A sale happens when the two finally meet.",
    concept: "supply-demand",
  },
  {
    id: "basis-points",
    term: "Basis point (bps)",
    definition: "1/100th of a percentage point — a tiny unit economists use so \"0.25%\" can be said as \"25 basis points\" without ambiguity.",
    analogy: "If a percent is a dollar, a basis point is a penny of that dollar. So a \"25 bps rate cut\" just means the interest rate dropped by a quarter of one percent.",
    concept: null,
  },
  {
    id: "order-book",
    term: "Order book",
    definition: "The live, running list of everyone's current buy and sell offers, stacked from best price to worst.",
    analogy: "A restaurant waitlist sorted by how much people are willing to tip to jump the line — the order book is that same idea, but for prices instead of tips.",
    concept: "supply-demand",
  },
  {
    id: "arbitrage",
    term: "Arbitrage",
    definition: "Making a (near) guaranteed profit by exploiting a price difference for the same thing across two places.",
    analogy: "Buying a concert ticket for $50 from a reseller who doesn't realize it's underpriced, then immediately reselling it for $65 to someone who doesn't know about the cheaper listing.",
    concept: "opportunity-cost",
  },
  {
    id: "market-maker",
    term: "Market maker",
    definition: "A trader (often a bot) that continuously offers to both buy and sell, keeping the market liquid, and earns money off the spread.",
    analogy: "An airport currency exchange booth — always ready to buy or sell your currency, making a small profit on the gap between the rate they buy at and the rate they sell at.",
    concept: "risk-reward",
  },
  {
    id: "outcome",
    term: "Outcome",
    definition: "One specific possible resolution being traded on a market — e.g. \"Yes\"/\"No\", or one named candidate among several. Each outcome has its own price.",
    analogy: "Like one horse in a horse race — the market lists odds (a price) for every horse separately.",
    concept: null,
  },
  {
    id: "resolution",
    term: "Resolution",
    definition: "How and when a market's real-world outcome gets determined, so it can pay out — usually tied to a named news source or official data release.",
    analogy: "The referee's final call at the end of a game — until it happens, the scoreboard (price) is just everyone's best guess.",
    concept: null,
  },
  {
    id: "open-interest",
    term: "Open interest",
    definition: "The total number of contracts currently outstanding — bets that are live and haven't been closed out or resolved yet.",
    analogy: "Counting how many bets at a sportsbook are still \"active\" right now, as opposed to ones that have already been settled and paid out.",
    concept: "supply-demand",
  },
  {
    id: "slippage",
    term: "Slippage",
    definition: "The difference between the price you expected to pay and what you actually ended up paying — usually because your order was big enough to move the price as it filled.",
    analogy: "Buying the last few tickets to a concert: the price creeps up as you buy more, because you're eating through the cheapest ones first.",
    concept: "opportunity-cost",
  },
  {
    id: "price-change",
    term: "24h price change",
    definition: "How much a contract's price moved over the last day — a quick signal for \"something just happened.\"",
    analogy: "Checking a stock ticker's daily percent change on the news — a big jump almost always means new information hit the market.",
    concept: "info-aggregation",
  },
  {
    id: "opportunity-cost",
    term: "Opportunity cost",
    definition: "The value of the next-best option you gave up by choosing something else. Not unique to trading — it's a general economics idea.",
    analogy: "If you spend $100 on this contract, that's $100 you can no longer invest elsewhere, save, or spend on something else. The \"cost\" isn't just the $100 — it's everything else that $100 could have done.",
    concept: "opportunity-cost",
  },
  {
    id: "supply-demand",
    term: "Supply and demand",
    definition: "The basic force behind every price: when more people want to buy than sell, price rises. When more want to sell than buy, price falls.",
    analogy: "Concert ticket prices spike right before a show sells out (demand outpacing supply), then crash right after if the show gets a bad review (supply outpacing demand).",
    concept: "supply-demand",
  },
  {
    id: "risk-reward",
    term: "Risk vs. reward",
    definition: "Higher potential payouts usually come with a higher chance of losing everything. A contract priced at 5¢ pays out 20x if it hits — precisely because it's expected to lose most of the time.",
    analogy: "A $1 lottery ticket with a shot at $1,000,000 vs. a savings account paying 4% a year, guaranteed. Same money, wildly different risk — and that's exactly why they're priced so differently.",
    concept: "risk-reward",
  },
];
