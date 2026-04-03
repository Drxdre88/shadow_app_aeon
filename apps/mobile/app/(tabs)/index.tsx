import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useProjects } from '@/hooks/use-projects'

export default function ProjectsScreen() {
  const { data: projects, isLoading } = useProjects()

  if (isLoading) {
    return (
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.loading}>
          <ActivityIndicator size="large" color="#8b5cf6" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safeArea} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerText}>Projects</Text>
      </View>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/project/${item.id}` as never)}
            style={s.card}
          >
            <Text style={s.cardTitle}>{item.name}</Text>
            {item.description ? (
              <Text style={s.cardDesc} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 48 }}>
            <Text style={{ color: '#6b7280', fontSize: 16 }}>No projects yet</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0f' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  headerText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardDesc: { color: '#9ca3af', fontSize: 14, marginTop: 4 },
})
