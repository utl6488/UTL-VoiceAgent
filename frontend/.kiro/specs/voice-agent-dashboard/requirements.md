# Requirements Document

## Introduction

The Voice Agent Dashboard is a lightweight React frontend for a voice-agent system that collects phone numbers through spoken conversation. The frontend has two primary areas: a Call page where a tester starts a voice session with the agent and watches the conversation progress live, and a Dashboard where collected phone number records can be viewed, searched, filtered, and deleted.

The backend is the authoritative source of truth. The frontend does not parse phone numbers and does not persist records locally; it reads from and writes to backend endpoints (`GET /api/phone`, `DELETE /api/phone/:id`, `GET /api/stats`, and a session/token endpoint for voice transport). The guiding principle is "functional, not fancy": the implementation should be correct and usable without over-design.

The feature is considered complete when a tester can run the dev server, open the Call page, speak a phone number end-to-end, and see the resulting row appear in the Dashboard with the correct parsed digits and language tag.

## Glossary

- **Frontend**: The React + Vite + TypeScript single-page application described by this specification.
- **Call_Page**: The page at route `/call` that lets a tester start and stop a voice session with the agent and view live conversation state.
- **Dashboard_Page**: The page at route `/dashboard` that lists, filters, and deletes collected phone number records.
- **Voice_Client**: The frontend module (`lib/voiceClient.ts`) that wraps the voice transport (Pipecat JS or LiveKit) and exposes `start()`, `stop()`, `onTranscript(cb)`, and `onState(cb)`.
- **API_Layer**: The frontend module (`api/phone.ts`) that wraps HTTP calls to backend phone, stats, and session endpoints.
- **Phone_Record**: A record returned by the backend representing one collected phone number, containing at minimum `id`, `parsedNumber`, `language`, `collectedAt`, and `rawTranscript`.
- **Session_State**: The current stage of a voice conversation, one of `GREETING`, `COLLECTING`, `CONFIRMING`, or `DONE`.
- **Language_Tag**: The language classification of a record, one of `en`, `hi`, or `mixed`.
- **Stats_Bar**: The component that displays total and per-language record counts.
- **Backend**: The server that owns phone parsing, record persistence, statistics, and voice session negotiation.
- **VITE_API_URL**: The environment variable holding the base URL of the Backend.

## Requirements

### Requirement 1: Application Routing and Bootstrap

**User Story:** As a tester, I want the application to open to the correct pages via clear routes, so that I can navigate between the Call page and the Dashboard.

#### Acceptance Criteria

1. WHEN the Frontend is loaded at the root path `/`, THE Frontend SHALL redirect to the `/dashboard` route.
2. WHEN a user navigates to the `/call` route, THE Frontend SHALL display the Call_Page.
3. WHEN a user navigates to the `/dashboard` route, THE Frontend SHALL display the Dashboard_Page.
4. THE Frontend SHALL read the Backend base URL from the VITE_API_URL environment variable.

### Requirement 2: Start and Stop a Voice Session

**User Story:** As a tester, I want to start and stop a voice session from the Call page, so that I can talk to the agent and provide a phone number.

#### Acceptance Criteria

1. WHEN a user activates the microphone control while no session is active, THE Call_Page SHALL request the Voice_Client to start a session and transition the control to an active state.
2. WHEN a user activates the microphone control while a session is active, THE Call_Page SHALL request the Voice_Client to stop the session and transition the control to an inactive state.
3. IF the Voice_Client fails to establish a session, THEN THE Call_Page SHALL display an error notification and return the control to the inactive state.
4. THE Voice_Client SHALL expose `start`, `stop`, `onTranscript`, and `onState` operations to the Call_Page.

### Requirement 3: Live Transcript Display

**User Story:** As a tester, I want to see the live transcript of the conversation, so that I can confirm the agent is hearing me correctly.

#### Acceptance Criteria

1. WHEN the Voice_Client emits a transcript update, THE Call_Page SHALL append the transcript text to the transcript panel.
2. WHILE a session is active, THE Call_Page SHALL display the most recent transcript text in the transcript panel.

### Requirement 4: Session State and Digit Progress

**User Story:** As a tester, I want to see the current conversation state and how many digits have been captured, so that I can follow the agent's progress.

#### Acceptance Criteria

1. WHEN the Voice_Client emits a Session_State update, THE Call_Page SHALL display the current Session_State as a state badge.
2. WHEN the Voice_Client emits a captured digit count, THE Call_Page SHALL display the captured digit count against the expected total.
3. WHEN the Session_State becomes `DONE`, THE Call_Page SHALL display a completion notification.

### Requirement 5: Microphone Level Indicator

**User Story:** As a tester, I want a visible microphone level indicator, so that noise suppression and audio input are visible during a screen recording.

#### Acceptance Criteria

1. WHILE a session is active, THE Call_Page SHALL display a microphone level indicator that reflects the current audio input level.

### Requirement 6: List Phone Records

**User Story:** As a reviewer, I want to see all collected phone records in the Dashboard, so that I can review what the agent collected.

#### Acceptance Criteria

1. WHEN the Dashboard_Page is mounted, THE API_Layer SHALL request phone records from `GET /api/phone`.
2. WHILE the Dashboard_Page is displayed, THE Dashboard_Page SHALL refetch phone records every 10 seconds.
3. WHEN phone records are received, THE Dashboard_Page SHALL display each Phone_Record with its parsed number, Language_Tag, and collected timestamp in a table.
4. WHILE phone records are being loaded for the first time, THE Dashboard_Page SHALL display a loading skeleton.
5. IF the phone record list is empty, THEN THE Dashboard_Page SHALL display an empty state message.
6. WHEN a user selects a Phone_Record row, THE Dashboard_Page SHALL expand the row to display the record's raw transcript.

### Requirement 7: Filter Phone Records

**User Story:** As a reviewer, I want to filter phone records by number, language, and date, so that I can find specific records quickly.

#### Acceptance Criteria

1. WHEN a user enters text in the phone number search field, THE Dashboard_Page SHALL request records whose parsed number contains the entered text as a substring.
2. WHEN a user selects a language chip of `en`, `hi`, or `mixed`, THE Dashboard_Page SHALL request records matching the selected Language_Tag.
3. WHEN a user selects the `all` language chip, THE Dashboard_Page SHALL request records of every Language_Tag.
4. WHEN a user sets a from date or a to date, THE Dashboard_Page SHALL request records whose collected timestamp falls within the specified date range.
5. WHEN a user sets only a from date and no to date, THE Dashboard_Page SHALL request records whose collected timestamp is greater than or equal to the from date with no upper bound.
6. WHEN a user applies multiple filters together, THE API_Layer SHALL include every active filter as a query parameter in the `GET /api/phone` request.

### Requirement 8: Delete Phone Records

**User Story:** As a reviewer, I want to delete a phone record, so that I can remove unwanted or test entries.

#### Acceptance Criteria

1. WHEN a user activates the delete action on a Phone_Record, THE Dashboard_Page SHALL display a confirmation modal.
2. WHEN a user confirms the deletion, THE API_Layer SHALL send a `DELETE /api/phone/:id` request for the selected record.
3. WHEN a user confirms the deletion, THE Dashboard_Page SHALL optimistically remove the record from the displayed list.
4. WHEN a user cancels the confirmation modal, THE Dashboard_Page SHALL retain the record and close the modal.
5. IF a delete request fails, THEN THE Dashboard_Page SHALL restore the record to its original position in the displayed list and display an error notification.

### Requirement 9: Statistics Display

**User Story:** As a reviewer, I want to see total and per-language counts, so that I can understand the distribution of collected numbers at a glance.

#### Acceptance Criteria

1. WHEN the Dashboard_Page is mounted, THE API_Layer SHALL request statistics from `GET /api/stats`.
2. WHEN statistics are received, THE Stats_Bar SHALL display a total count tile and per-language count tiles for English, Hindi, and Mixed.
3. IF the statistics payload is missing or malformed such that the four tiles cannot be rendered, THEN THE Stats_Bar SHALL display an explicit error or empty state.

### Requirement 10: Centralized API Error Handling

**User Story:** As a tester, I want API failures to be surfaced clearly, so that I know when something went wrong instead of seeing a silent failure.

#### Acceptance Criteria

1. IF a request issued by the API_Layer returns a non-success response, THEN THE API_Layer SHALL raise an error that identifies the failed operation.
2. WHEN a request issued by the API_Layer fails, THE Frontend SHALL display an error notification to the user.

### Requirement 11: Backend as Source of Truth

**User Story:** As a system designer, I want the frontend to defer to the backend for parsing and persistence, so that record data stays authoritative and consistent.

#### Acceptance Criteria

1. THE Frontend SHALL display the parsed number and Language_Tag exactly as provided by the Backend without performing phone number parsing.
2. WHEN the Frontend needs phone record data, THE Frontend SHALL retrieve the data from the Backend rather than from client-side persisted storage.
