import React from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useAppContext } from './src/context/AppContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { DirectorScreen } from './src/screens/DirectorScreen';
import { TeacherScreen } from './src/screens/TeacherScreen';
import { ParentScreen } from './src/screens/ParentScreen';
import { StudentScreen } from './src/screens/StudentScreen';
import { StaffScreen } from './src/screens/StaffScreen';

function AppInner() {
  const app = useAppContext();

  if (!app.currentUser || !app.snapshot) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <LoginScreen onLogin={app.login} loading={app.loading} />
      </SafeAreaView>
    );
  }

  const commonShellProps = {
    showOriginal: app.showOriginal,
    onToggleOriginal: app.toggleShowOriginal,
    onRefresh: app.refresh,
    onLogout: app.logout,
  };

  if (app.currentUser.role_id === 1) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <DirectorScreen
          user={app.currentUser}
          snapshot={app.snapshot}
          {...commonShellProps}
          onAssignHomeroom={app.assignHomeroom}
          onUpdateRole={app.updateRole}
          onPublishAnnouncement={({ text }) => app.publishAnnouncement({ text })}
          onUpdateFeedback={app.updateFeedback}
          onPublishScheduleUpdate={({ lessonId, subject, room, reason }) =>
            app.publishScheduleUpdate({ lessonId, subject, room, reason })
          }
        />
      </SafeAreaView>
    );
  }

  if (app.currentUser.role_id === 3) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <TeacherScreen
          user={app.currentUser}
          snapshot={app.snapshot}
          {...commonShellProps}
          onSaveHomework={({ homeworkId, lessonId, text, attachments, source, ocrRawText }) =>
            app.saveHomework({ homeworkId, lessonId, text, attachments, source, ocrRawText })
          }
          onSendMessage={({ threadId, text, attachments }) =>
            app.sendThreadMessage({ threadId, text, attachments })
          }
          onPublishAnnouncement={({ text, classId }) => app.publishAnnouncement({ text, classId })}
          onMarkRead={app.markRead}
          onUpdateFeedback={({ feedbackId, status }) => app.updateFeedback({ feedbackId, status })}
        />
      </SafeAreaView>
    );
  }

  if (app.currentUser.role_id === 4) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ParentScreen
          user={app.currentUser}
          snapshot={app.snapshot}
          {...commonShellProps}
          onSendAbsence={({ studentId, lessonId, note }) =>
            app.sendAbsence({ studentId, lessonId, note })
          }
          onSendMessage={({ threadId, text, attachments }) =>
            app.sendThreadMessage({ threadId, text, attachments })
          }
          onMarkRead={app.markRead}
        />
      </SafeAreaView>
    );
  }

  if (app.currentUser.role_id === 5) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <StudentScreen
          user={app.currentUser}
          snapshot={app.snapshot}
          {...commonShellProps}
          onMarkRead={app.markRead}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <StaffScreen
        user={app.currentUser}
        snapshot={app.snapshot}
        {...commonShellProps}
        onMarkRead={app.markRead}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <View style={styles.container}>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#eef4ff',
  },
});
