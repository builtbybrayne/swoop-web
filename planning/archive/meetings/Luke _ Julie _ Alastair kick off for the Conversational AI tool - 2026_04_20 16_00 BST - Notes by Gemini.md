Apr 20, 2026

## **Luke / Julie / Alastair kick off for the Conversational AI tool**

Invited [Julie Isaacs](mailto:julie.isaacs@swoop-adventures.com) [al@icanbeunbreakable.com](mailto:al@icanbeunbreakable.com) [Luke Errington](mailto:luke@swoop-adventures.com)

Attachments [Luke / Julie / Alastair kick off for the Conversational AI tool](https://calendar.google.com/calendar/event?eid=MzlnNW5xcDFqa2Nqam0xYWJ1aGh2aGNpOW8gbHVrZUBzd29vcC1hZHZlbnR1cmVzLmNvbQ)

Meeting records [Transcript](https://docs.google.com/document/d/1a5SnPXE9H-QS3uNZZocBLsqZXYEJ4wHxcal9AsQCGu0/edit?usp=drive_web&tab=t.j0j17cave6ux) 

### **Summary**

The project kickoff defined the AI conversational tool scope and alignment with Patagonia sales and strategy.

**Project Scope and Strategy**  
The tool will handle discovery and triage to identify qualified leads for sales handoff. The primary focus is generating demand for group tours and high-value tailor-made travel.

**Customer Segmentation and Data**  
Customers were segmented by independence level, region, activities, and budget. Existing website content will serve as the core data source for AI training and guidance.

**Technical Constraints and Integration**  
Development will prioritize core orchestration to avoid generating full itineraries. The team decided to use internal Claude services for large-scale data processing and technical alignment.

### **Next steps**

- [ ] \[Alastair Brayne\] Forward Document: Forward the Antarctica sales thinking document structure (Emma's doc) to Luke Errington.

- [ ] \[Alastair Brayne\] Define Documentation: Inform Luke Errington of the written customer journey detail required from him and Lane.

- [ ] \[Luke Errington, Lane\] Create Documentation: Recreate the Patagonia sales thinking document; provide written documentation within the next 1 to 2 weeks.

- [ ] \[Julie Isaacs\] Clean Data: Clean the raw customer age data; send data to Alastair.

- [ ] \[Luke Errington\] Share Strategy: Share the strategic Google Doc about Patagonia future and customer types with Alastair Brayne.

- [ ] \[Julie Isaacs\] Schedule Meeting: Schedule the technical conversation meeting for tomorrow at 2 PM; include Claude services discussion.

- [ ] \[Julie Isaacs\] Check Account: Check with Tom to confirm if the recently extended Claude service account is an Enterprise account.

### **Details**

* **Meeting Kickoff and Conversational Tool Introduction**: Julie Isaacs initiated the call, welcoming Alastair Brayne and noting that the purpose of the meeting was to kick off the conversational tool project for Patagonia. The agenda included covering administrative questions and allowing Luke Errington to discuss the Patagonian customer profile, their journey, and how the sales team manages conversations. Luke Errington was also consuming a gold biscuit at the start of the meeting ([00:00:00](?tab=t.j0j17cave6ux#heading=h.5d7tz9h8vuwz)).

* **Project Scope and Core Questions for the AI**: Alastair Brayne confirmed that the discussion was exactly what they needed, specifically focusing on the fundamental questions the AI would be asked, the information it needs to surface, and the ideal input and output formats. Julie Isaacs agreed, noting that the output was a key topic for discussion, particularly regarding handoffs based on where customers are in their buying journey ([00:01:09](?tab=t.j0j17cave6ux#heading=h.98lta263t03)).

* **Understanding the Conversational Tool's Goal**: Alastair Brayne's understanding is that the goal of the customer-facing tool is similar to the one developed for ChatGPT but adapted for Patagonia's data. The tool should inspire users and encourage them to seek further information or a call with the sales team, as the flexibility and complexity of Patagonia's options require human involvement. The AI should avoid generating inaccurate or "hallucinating" itineraries ([00:02:10](?tab=t.j0j17cave6ux#heading=h.xudzyimln2gg)).

* **Customer Journey Stage and Triage Functionality**: Luke Errington agreed with Alastair Brayne's assessment that the AI should handle the discovery and interest phases, handing off at consideration, aligning with the AIDA marketing funnel. Luke Errington specified that unlike the Antarctica trips, which want all inquiries, the Patagonia team needs the AI to perform triage to identify desired versus undesired inquiries in the discovery phase ([00:03:19](?tab=t.j0j17cave6ux#heading=h.og4dodn4p977)).

* **Need for Sales Documentation for Patagonia**: Alastair Brayne requested documentation equivalent to the sales thinking documents provided by Emma for the Antarctica project, asking if Luke Errington had a PDF or similar resource capturing their description of the Patagonia sales approach. Luke Errington confirmed that while there are relevant website pages, they would need time to document the information in writing, but preferred to start with a verbal description ([00:04:33](?tab=t.j0j17cave6ux#heading=h.2dkglwij57s7)).

* **Project Timeline and Data Guidance Development**: Alastair Brayne reassured the team that the lack of immediate documentation is not a problem because the initial phase of the project involves fundamental "piping" and setting up the core orchestration engine, which is expected to take one to two weeks. This timeline allows for the guidance layer for the AI, focusing on the business domain, to be pulled together concurrently ([00:05:28](?tab=t.j0j17cave6ux#heading=h.sgiwvwdlbkxp)).

* **Leveraging AI to Generate Sales Documentation**: Alastair Brayne suggested that the process of explaining the business domain to the AI conversationally presents an opportunity to iteratively create the necessary guidance documentation. They could instruct the AI to consolidate the verbal and existing documentation into a single PDF, potentially using the Antarctica documentation as a template to be converted for Patagonia ([00:06:26](?tab=t.j0j17cave6ux#heading=h.v5ajw44tus4l)). Luke Errington will provide the most useful written information over the next one to two weeks ([00:08:11](?tab=t.j0j17cave6ux#heading=h.7ey49l541ptk)).

* **Initial Project Start and Data Structure**: Alastair Brayne confirmed they are not blocked and will start working immediately on setting up the core libraries and SDKs, which buys time for data exchanges. Luke Errington confirmed that the Patagonia data set should follow common patterns structurally, similar to the Antarctica data, although Julie Isaacs noted potential complications related to launching a new group tours product ([00:08:11](?tab=t.j0j17cave6ux#heading=h.7ey49l541ptk)).

* **Strategic Consideration for Group Tours**: Julie Isaacs raised the point that they are launching a new group tours product for Patagonia, and they might want to add business rules for the AI to highlight their products without forcing an unnatural fit for customers. Luke Errington concurred, stating that generating group tour demand would be a huge favor to the project, and Alastair Brayne confirmed this primarily involves adding another data item and guidance, not a structural implication ([00:09:19](?tab=t.j0j17cave6ux#heading=h.ssfli9q0wgr4)).

* **Segmentation of Patagonian Visitors by Independence Level**: Luke Errington initiated a verbal description of Patagonian customers, noting that they are basing this on 16 years of experience rather than detailed web analytics ([00:11:12](?tab=t.j0j17cave6ux#heading=h.f7t45redt3l9)). They first ruled out backpackers, who use the website but do not typically book high-cost services ([00:12:22](?tab=t.j0j17cave6ux#heading=h.sq7v233wgaen)). Luke Errington then defined the first dimension of target customers based on independence: Group Tourers (wanting full hand-holding), Tailor-Made Customers (wanting private trips with full support), and Independents (only looking for a guide for specific activities) ([00:13:24](?tab=t.j0j17cave6ux#heading=h.8v373xlw6m2n)).

* **Segmentation by Regional Preferences and Activities**: The second customer dimension is the region, noting that over 80% of bookings involve Torres del Paine, which is the key consideration for customers ([00:15:31](?tab=t.j0j17cave6ux#heading=h.v4gt8adirdy)) ([00:17:34](?tab=t.j0j17cave6ux#heading=h.izq5pwzaknxm)). They segmented this into Torres del Paine only, Torres del Paine plus one mainstream trip, and those seeking off-the-beaten-track regions ([00:16:30](?tab=t.j0j17cave6ux#heading=h.ypwwsvn5oeo7)). The third dimension is activities, which range from "softer adventure" (wilderness sightseeing and short hikes) to "hikers" (multi-day treks with shared dorms) and "trekkers" (extended treks carrying their own gear) ([00:17:34](?tab=t.j0j17cave6ux#heading=h.izq5pwzaknxm)).

* **The "Why" Motivation and Budget Dimension**: Alastair Brayne inquired about the customers' "why" or motivation, as tying back to this anchor is critical for the AI's conversational imagination ([00:20:01](?tab=t.j0j17cave6ux#heading=h.q5csyut0ipx8)). Luke Errington then introduced the fourth dimension, budget, noting that Patagonia is surprisingly expensive. Budget often correlates with independence, ranging from group tours (improving economics) and self-booked travel, up to stays in luxury properties costing thousands per day ([00:21:54](?tab=t.j0j17cave6ux#heading=h.dzku95wqw4s4)). Motivations for travel include hiking the famous W trail, seeing accessible glaciers, puma photography, and acquiring "bragging rights" and status associated with exclusive lodges ([00:22:57](?tab=t.j0j17cave6ux#heading=h.nha6b9swle51)) ([00:25:15](?tab=t.j0j17cave6ux#heading=h.x6i44klded0h)).

* **Demographics, Avatars, and Data Analysis for the AI**: Alastair Brayne noted that understanding the "why," such as once-in-a-lifetime trips, status-seeking, or bucket lists, is crucial for the AI's psychological engagement ([00:21:01](?tab=t.j0j17cave6ux#heading=h.u2pb10bes2eq)) ([00:26:03](?tab=t.j0j17cave6ux#heading=h.tjtgsxtv1jmr)). Luke Errington provided examples of recent travelers they met, including a wealthy Indian couple focused on puma photography and luxury lodges, a Canadian family taking luxurious annual holidays, and an American couple on a post-retirement trip of a lifetime ([00:27:08](?tab=t.j0j17cave6ux#heading=h.g2tjc0o9xoz0)). Julie Isaacs confirmed they have raw age and inquiry data for all customers that they are currently cleaning and compiling into personas ([00:33:37](?tab=t.j0j17cave6ux#heading=h.jzt852zep1)).

* **Identifying Valuable Data Sources for the AI**: Luke Errington shared links in the chat to existing website pages that detail how they can help customers, five reasons to choose Patagonia, and activity options, suggesting these would be helpful for the AI. Julie Isaacs added that the blog is also an important resource, and Alastair Brayne confirmed they will have an AI crawl the site and index the data ([00:35:21](?tab=t.j0j17cave6ux#heading=h.anahp0rv4ve6)). The blog has hundreds of articles, likely spanning the last five years, and Alastair Brayne concluded they would not need a Content Management System (CMS) API but would let an AI process the content ([00:37:31](?tab=t.j0j17cave6ux#heading=h.lfsnr8jkrwbg)).

* **AI Usage Costs and Claude Account Strategy**: Alastair Brayne raised a concern about the rising cost of large language model (LLM) usage, particularly Claude, for data processing and requested to use Swoop's Claude services for "pure data munching" ([00:39:18](?tab=t.j0j17cave6ux#heading=h.sbtyj35lzp1f)). Luke Errington confirmed they would find a way for Alastair Brayne to run data processing without using their personal account, suggesting the development team's recently extended Claude access ([00:40:11](?tab=t.j0j17cave6ux#heading=h.wybq4edbxt6)).

* **Strategic Context for Swoop Patagonia and Group Tours**: Luke Errington shared a document outlining the strategy for Swoop Patagonia, which concludes that their future heavily relies on group tours, aiming for them to constitute half of all bookings. A key strategic consideration is how to drive inquiry flow for group tours, making the AI's ability to identify group tour candidates highly valuable ([00:41:41](?tab=t.j0j17cave6ux#heading=h.wqjdhu55czeo)). The other two strategic threads are maintaining the existing tailor-made Family and Independent Traveler (FIT) segment and developing a referral model for smaller, low-contribution bookings where Swoop does not provide customer service ([00:42:55](?tab=t.j0j17cave6ux#heading=h.k86tg632ty7w)). Luke Errington will share this strategic document with Alastair Brayne ([00:44:11](?tab=t.j0j17cave6ux#heading=h.aq4opla115oj)).

* **Integration Planning and Technical Discussion**: Alastair Brayne emphasized the need for a technical discussion soon to align their implementation plan with Swoop's existing integration and rationalization efforts, noting that some legacy system decisions might conflict with moving to an AI world ([00:47:07](?tab=t.j0j17cave6ux#heading=h.kqfwtcaocxsb)). Julie Isaacs agreed to set up this technical conversation soon ([00:48:05](?tab=t.j0j17cave6ux#heading=h.723fgmzcqst3)).

* **Controlling AI to Avoid Building Itineraries**: Julie Isaacs voiced a concern about the AI accidentally constructing a complete itinerary that customers could take away, given the tailor-made nature of Patagonia trips ([00:48:05](?tab=t.j0j17cave6ux#heading=h.723fgmzcqst3)). Alastair Brayne confirmed that the AI's full remit is limited to imagination and discovery, and they will explicitly build a system that prevents the AI from creating itineraries, thus maintaining the handoff to the sales team ([00:48:59](?tab=t.j0j17cave6ux#heading=h.ugv4gb9uy8b6)).

* **Future Data Use for Personalization and Trends**: Julie Isaacs asked if it would be possible to feed location-based data (e.g., IP address) into the AI if machine learning later revealed trends, such as West Coast US buyers having a high propensity to book certain trips ([00:51:04](?tab=t.j0j17cave6ux#heading=h.f2j1o3ilswhe)). Alastair Brayne confirmed that if an insights database were developed through machine learning, the AI could be configured to query and use that context to improve conversations ([00:51:57](?tab=t.j0j17cave6ux#heading=h.rfcjlwmftpa)) ([00:53:44](?tab=t.j0j17cave6ux#heading=h.lcqvhyykb4vv)).

* **Strategic Considerations: Profitability, Solos, and Inventory**: Luke Errington shared additional strategic points, including the finding that bookings yielding less than $1,000 in profit result in a negative contribution, which reinforces the need to refer low-value trips ([00:54:28](?tab=t.j0j17cave6ux#heading=h.xfk44j922bbh)). Another point is the shortage of inquiries at certain times, noting that solo travelers, often ignored by sales, are a good fit for group tours, making early identification of solo travelers very meaningful. Finally, they have an inventory constraint in December to February, particularly for luxury lodges, requiring bookings 6 to 12 months in advance ([00:55:16](?tab=t.j0j17cave6ux#heading=h.3fryc4f3l6oo)).

* **Technical Meeting Scheduled**: The next step is a technical conversation with Julie Isaacs and the tech team, which Alastair Brayne requested as soon as possible ([00:56:26](?tab=t.j0j17cave6ux#heading=h.odxsjii4lf12)). Julie Isaacs scheduled this meeting for 2:00 p.m. the following day, during which they will also discuss the Claude account details ([00:57:29](?tab=t.j0j17cave6ux#heading=h.xj1monwa38cp)).

*You should review Gemini's notes to make sure they're accurate. [Get tips and learn how Gemini takes notes](https://support.google.com/meet/answer/14754931)*

*How is the quality of **these specific notes?** [Take a short survey](https://google.qualtrics.com/jfe/form/SV_9vK3UZEaIQKKE7A?confid=6TFCLssrwECA19tBv4hRDxISOAIIigIgABgDCA&detailid=standard&screenshot=false) to let us know your feedback, including how helpful the notes were for your needs.*