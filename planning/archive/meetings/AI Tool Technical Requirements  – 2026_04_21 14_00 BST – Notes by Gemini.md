Apr 21, 2026

## AI Tool Technical Requirements 

Invited [Julie Isaacs](mailto:julie.isaacs@swoop-adventures.com) [Thomas Forster](mailto:thomas.forster@swoop-adventures.com) [Richard Connett](mailto:richard@swoop-adventures.com) [al@icanbeunbreakable.com](mailto:al@icanbeunbreakable.com)

Attachments [AI Tool Technical Requirements ](https://calendar.google.com/calendar/event?eid=MmsxZDdhajM5czF2MWs0YTJrODVxbTBjNHAganVsaWUuaXNhYWNzQHN3b29wLWFkdmVudHVyZXMuY29t)

Meeting records [Transcript](https://docs.google.com/document/d/1FKNTfvyWJA2v4Nb4_rh2jLBwLO1njTLee4uh1NeCgtc/edit?usp=drive_web&tab=t.9suqk9cev30l) 

### Summary

The team aligned on building an AI agent via React and Google Cloud for sales support.

**Initial AI Project Scope**  
The team defined the AI agent's purpose as a sales-focused tool for user engagement and persona capture. They decided to prioritize a Patagonia prototype to serve as the functional foundation.

**Technical Architecture and Implementation**  
They agreed to implement a Retrieval Augmented Generation solution using Google Vertex AI and host via Cloud Run. The interface will be developed in React to align with existing frameworks.

**Data Extraction and Integration**  
The team decided to utilize website scraping for data retrieval because critical information resides outside current databases. They plan to map the data ontology during a collaborative session.

### Next steps

- [ ] \[Thomas Forster\] Setup GCP: Set up a Google Cloud Platform project named AI Pat Chat. Provide Alastair Brayne appropriate IAM access for development.

- [ ] \[Julie Isaacs\] Schedule Session: Confirm feasibility and schedule a 1-day working session for Alastair Brayne to determine ETL strategy. Target Friday, utilizing Thomas Forster or Martin due to domain knowledge.

- [ ] \[The group\] Provide Data Access: Grant access to the MongoDB environment. Gather and provide information regarding input variables for existing public API endpoints.

- [ ] \[Alastair Brayne\] Implement Search: Implement necessary search functionality for Patagonia data due to increased volume. Target Google Vertex AI or Weeviate platform.

- [ ] \[Alastair Brayne\] Build Scraper: Build an AI scraper utility to extract necessary information from the current website. Use Claude deep research and prompt engineering for data extraction.

- [ ] \[Alastair Brayne\] Hand Off Script: Hand off the data ingestion ETL script to The group. Ensure the group can run the script at a regular cadence.

### Details

* **Introductions and Tool Overview**: The meeting began with introductions, noting that the project has moved quickly and included discussion of pumas as an example topic. Richard Connett, a tech lead at Swoop for three years, and Thomas Forster, a senior developer, introduced themselves. Alastair Brayne, who specializes in AI and prompt engineering, provided their background in software and interest in combining tech with human psychology ([00:00:43](?tab=t.9suqk9cev30l#heading=h.jwcvz2vpf08h)).

* **AI Tooling and Team Training**: Alastair Brayne noted that they are currently focused on building AI toolings, team training, and individual AI personal assistant setups. Their goal is to help people integrate an AI way of working across the technical and non-technical stacks. Julie Isaacs expressed interest in having a separate conversation about the psychotherapy aspect of Alastair Brayne's background ([00:02:48](?tab=t.9suqk9cev30l#heading=h.8iye5hxsfnfb)).

* **Prototype Goal and Scope**: Alastair Brayne explained that the goal of the initial experimental prototype was to integrate a chat agent using the apps SDK to drive imagination about Antarctica and excitement for Swoop. The agent's function is sales-focused, aiming to move users from awareness through interest to consideration and providing a rich handoff to the sales team with a wish list and user persona capture. The work is focused on read-only world and inspiring people, not programmatic outputs or itinerary building ([00:04:33](?tab=t.9suqk9cev30l#heading=h.yjcmmohhrkfl)).

* **Technology Stack and Strategy**: Alastair Brayne intends to build the fundamental agentic substrate in TypeScript using Google ADK, specifically avoiding Python libraries ([00:05:45](?tab=t.9suqk9cev30l#heading=h.z4vv5hmc34gm)). The strategy for handling data for the Patagonia project needs to be more robust than the initial prototype, which relied on small data sources shoved into markdown files. The new strategy requires implementing a search solution because the volume of data is too large for the previous method ([00:06:49](?tab=t.9suqk9cev30l#heading=h.ddc0t5o7kvgh)).

* **Data Search Implementation Plan**: Alastair Brayne’s current top recommendation is to use Google's Vertex AI, where documents can be ingested for under-the-hood processes like Retrieval Augmented Generation (RAG) and automatic re-ranking. RAG involves taking a document, having an LLM create a vector embedding representing it, and making that vector searchable ([00:07:49](?tab=t.9suqk9cev30l#heading=h.6k01gcc52clz)). Since the project is targeting a rollout in a matter of weeks, the priority is the fastest, reasonably good implementation, not a complex or perfect solution ([00:08:50](?tab=t.9suqk9cev30l#heading=h.921m41scfbwj)).

* **Infrastructure and Data Source Management**: The goal is to minimize new infrastructure and avoid creating alternative sources of truth, ensuring that all derived data is fed by the existing Mongo database. Alastair Brayne mentioned exploring Weeviate as a potential turnkey solution, depending on the pricing structure ([00:09:56](?tab=t.9suqk9cev30l#heading=h.bfzifffodxd2)). Richard Connett confirmed that the proposal to build a self-contained JavaScript widget for the website that communicates with the sales team sounds plausible, and they can provide access to the Mongo and MySQL databases ([00:12:05](?tab=t.9suqk9cev30l#heading=h.x0eqrtwk8zk5)).

* **Data Ingestion for Website Content**: Richard Connett noted that the product information is in MongoDB, while website content is in a MySQL database. Alastair Brayne suggested that scraping the website might be easier for the AI to get contextual understanding, which Richard Connett agreed to since it involves zero work for the in-house team ([00:12:56](?tab=t.9suqk9cev30l#heading=h.iw8kmpfpjsy2)). They discussed using Claude deep research with prompt engineering to create a script for data extraction, noting that this strategy allows for quick V1 deployment and handles the upcoming website migration, even if the extraction script will need updating later ([00:13:51](?tab=t.9suqk9cev30l#heading=h.utjrft5p7qhm)) ([00:36:38](?tab=t.9suqk9cev30l#heading=h.2deg4q8xwecw)).

* **Hosting and Architecture**: Alastair Brayne proposes hosting the application as a Cloud Run instance due to latency concerns, rather than a Lambda function ([00:15:54](?tab=t.9suqk9cev30l#heading=h.mct8pu947jn5)). They intend to build a server with endpoints and discussed the possibility of having two Cloud Runs: one for an agent orchestrator and one for an MCP (Master Control Program) connector to expose raw data, favoring the latter for better scalability and easier handover ([00:16:55](?tab=t.9suqk9cev30l#heading=h.xm0yakqleo15)). Alastair Brayne committed to providing extensive documentation and implementation plans to facilitate a smooth handover to the internal team ([00:18:06](?tab=t.9suqk9cev30l#heading=h.sbqdkwlkwb)).

* **User Interface and Development Framework**: The plan is to build a basic, unstyled UI using vanilla JavaScript and basic Tailwind, which the in-house team will then style. Thomas Forster requested using React for the UI framework to align with existing efforts to streamline frameworks, and Alastair Brayne agreed to build the front-end in React ([00:20:11](?tab=t.9suqk9cev30l#heading=h.gs536mmx56ru)).

* **Session Management and Messaging Queue**: For session management, Alastair Brayne will utilize solutions provided by the Google ADK ecosystem to keep the moving parts minimal. For streaming content, a messaging queue or streaming source is needed, such as a pub/sub system or Firebase Realtime DB, to prevent conversations from feeling stilted ([00:21:12](?tab=t.9suqk9cev30l#heading=h.yr72kyn59oj)). Since the internal team does not have a messaging platform currently in use, they agreed to stick with what Alastair Brayne recommends, preferably within the Google ecosystem ([00:22:30](?tab=t.9suqk9cev30l#heading=h.ln8yb52jrzow)).

* **Project Setup and Scope Definition**: The project will initially focus on Patagonia (PAT) because it represents the superset of functionality, meaning it should be trivial to apply the solution to Antarctica (Ant) later ([00:25:38](?tab=t.9suqk9cev30l#heading=h.m9lby4yvrag7)). Thomas Forster agreed to set up a GCP project for the conversational interface, which Julie Isaacs decided to name "AI Pat Chat" for specificity ([00:24:35](?tab=t.9suqk9cev30l#heading=h.5fhg5s999ds7)). They need to confirm whether the data ontology for Patagonia introduces different record types compared to the simpler Antarctica data ([00:26:37](?tab=t.9suqk9cev30l#heading=h.a1itz2vidfc8)).

* **Data Source and Accuracy Concerns**: The team confirmed that the current website is the main source of information, including prices, while the Mongo database contains only words and is missing critical information like pricing. Consequently, the AI agent must use the website as its primary data source to validate the project's outcome, even though this means the data extraction scripts will need to be rewritten when the website migrates to MongoDB in October ([00:37:39](?tab=t.9suqk9cev30l#heading=h.pfwy8rtb63jy)) ([00:39:26](?tab=t.9suqk9cev30l#heading=h.um4fhvrywkae)). Richard Connett noted that scraping the website is sensible, as information like prices and details about places only lives on the website and not in the product library ([00:38:31](?tab=t.9suqk9cev30l#heading=h.m46fr44ys6ju)).

* **Data Retrieval and Ontology Details**: The discussion moved to how to efficiently retrieve specific data elements like image URLs, which are currently tied to the website's MySQL database ([00:39:26](?tab=t.9suqk9cev30l#heading=h.um4fhvrywkae)). A concern was raised that internal IDs are not publicly published, making it difficult for the AI to associate scraped data with an ID. Thomas Forster suggested that the AI might be able to handle this if they implemented a meta tag containing the ID ([00:40:42](?tab=t.9suqk9cev30l#heading=h.75zw6ehrznzx)).

* **Scraping Challenges and Solution Proposal**: The team discussed the challenge of scraping due to React components and modern website practices where data is loaded dynamically and may not be in the initial HTML ([00:41:35](?tab=t.9suqk9cev30l#heading=h.frvmwrq31x42)). Thomas Forster clarified that 90% of the data is passed to the React components via PHP and is present in the HTML, making it visible to a scraper ([00:44:46](?tab=t.9suqk9cev30l#heading=h.pggo7ssv5p4g)). Alastair Brayne suggested having a simple API endpoint that spits out the data as JSON to ease ETL processes ([00:45:44](?tab=t.9suqk9cev30l#heading=h.tmjah432v8yy)).

* **Collaborative Data Mapping Strategy**: Since the team determined the most significant complexity is how to get the data out, Alastair Brayne proposed dedicating a day to work collaboratively with a knowledgeable developer, suggesting Thomas Forster or Martin, to map out the data ontology ([00:50:05](?tab=t.9suqk9cev30l#heading=h.4cuf7g1kuego)). Julie Isaacs agreed to review this request with Luke, prioritizing the necessity of securing one of the developers for a full day, ideally on Friday ([00:51:07](?tab=t.9suqk9cev30l#heading=h.s4e0d2jk262r)).

*You should review Gemini's notes to make sure they're accurate. [Get tips and learn how Gemini takes notes](https://support.google.com/meet/answer/14754931)*

*How is the quality of **these specific notes?** [Take a short survey](https://google.qualtrics.com/jfe/form/SV_9vK3UZEaIQKKE7A?confid=kENKeK_v0_lprWW4SCHbDxIQOAIIigIgABgDCA&detailid=standard&screenshot=false) to let us know your feedback, including how helpful the notes were for your needs.*