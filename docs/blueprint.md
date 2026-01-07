# **App Name**: Chamados Sync

## Core Features:

- Firestore Database Setup: Configures a Firestore database with a `chamados` collection.
- Scheduled Data Sync: Cloud Function triggered daily at 2:00 AM to sync data from a Google Sheet to Firestore.
- Google Sheets API Integration: Connects to Google Sheets API using a Service Account to access data.
- Data Transformation: Transforms data from Google Sheets to Firestore document structure, including type conversions.
- Upsert Operation: Implements upsert logic to update existing documents or create new ones in Firestore.
- Cloud Logging: Implements logging to track function execution, errors, and completion.

## Style Guidelines:

- Background color: Soft gray (#F4F4F4) for a clean and neutral backdrop.
- Primary color: Deep blue (#3F51B5) to represent reliability and trust in data management.
- Accent color: Vibrant purple (#7CB342) to highlight important actions or status indicators.
- Body font: 'Inter', a grotesque-style sans-serif for clear and readable data display.
- Headline font: 'Space Grotesk' sans-serif, for section titles.
- Use simple, geometric icons to represent data types and operations.
- Emphasize clarity and readability in data presentation with consistent spacing and alignment.