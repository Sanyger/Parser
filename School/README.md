### iOS TEST VIA EXPO GO

Steps:
1. Install Expo Go from App Store
2. npm install
3. npx expo start
4. Scan QR code with iPhone
5. Login using test credentials

# SCHOOL ISRAEL – Mobile App (MVP)

React Native + Expo + TypeScript MVP for Israeli school management with multi-role access, Sunday-Friday schedule, homework, messaging, translation, and push notifications.

## Tech Stack

- Frontend: React Native + Expo (managed workflow) + TypeScript
- Backend (MVP): local Node-style API layer inside app runtime (REST-shaped service) with JWT session token
- Push: Expo Notifications (local push for MVP)
- Timezone: `Asia/Jerusalem`

## Run

```bash
npm install
npx expo start
```

## One-Command Robot Start

```bash
./scripts/project-robot.sh
```

Stop:

```bash
./scripts/project-robot-stop.sh
```

## Test Credentials

- Director: `director1` / `1234`
- Teacher: `teacher1` / `1234`
- Parent: `parent1` / `1234`
- Student: `student1` / `1234`
- Staff: `staff1` / `1234`

## Seed Data Included

- School timezone: `Asia/Jerusalem`
- Enabled languages: `he`, `ru`, `en`
- Auto translation: enabled
- Class: `ג 1`
- Required relationship links are seeded:
  - Student `Марк Аракчеев` linked to parent `Аракчеев Александр`
  - Student linked to class `ג 1`
  - Teacher `Инна` linked to class `ג 1` and assigned to all lessons

## Implemented Features

- Role-based home screens:
  - Director
  - Teacher (with `is_homeroom` flag support)
  - Parent
  - Student (read-only messaging)
  - Staff
- Login screen with language selector (`he/ru/en`)
- Israeli school week UI:
  - Sunday-Friday shown as active
  - Saturday shown as disabled/greyed out
- Schedule change logic:
  - canceled lesson shown with strikethrough
  - changed replacement lesson shown below
  - reason visible in lesson detail
- Homework:
  - teacher add/edit
  - optional photo attachment
  - OCR placeholder text flow + editable confirmation
  - parent/student can view homework + attachment count
- Messaging:
  - teacher↔parent and announcement threads
  - fast send flow
  - read/seen state (`read_by`)
  - optional attachments
- Translation:
  - stores original text + original language
  - stores translations for `ru/en/he`
  - per-user preferred language display
  - `Show original` toggle
- Parent absence submission
- Push notification triggers (local notifications in Expo Go):
  - new message
  - homework added
  - schedule changed
  - announcement published

## Role and Permission Notes

- Homeroom teacher is not a separate user type; it is `role_id=3` + `is_homeroom=true`.
- Effective role mapping in UI:
  - `1` Director
  - `2` Homeroom Teacher (derived)
  - `3` Teacher
  - `4` Parent
  - `5` Student
  - `6` Staff

## Folder Structure

```text
.
├── App.tsx
├── app.json
├── babel.config.js
├── package.json
├── tsconfig.json
└── src
    ├── api
    │   └── mockApi.ts
    ├── components
    │   ├── HomeworkList.tsx
    │   ├── LanguageSelector.tsx
    │   ├── RoleLabel.tsx
    │   ├── ScheduleWeekView.tsx
    │   ├── SectionCard.tsx
    │   └── ThreadChat.tsx
    ├── context
    │   └── AppContext.tsx
    ├── data
    │   └── seed.ts
    ├── lib
    │   ├── auth.ts
    │   ├── notifications.ts
    │   ├── selectors.ts
    │   ├── time.ts
    │   └── translation.ts
    ├── screens
    │   ├── DirectorScreen.tsx
    │   ├── LoginScreen.tsx
    │   ├── ParentScreen.tsx
    │   ├── ScreenShell.tsx
    │   ├── StaffScreen.tsx
    │   ├── StudentScreen.tsx
    │   └── TeacherScreen.tsx
    └── types
        └── models.ts
```

## Notes

- This MVP intentionally uses an in-app local API service for immediate Expo Go startup without separate backend deployment.
- JWT is implemented as a lightweight MVP token flow.
