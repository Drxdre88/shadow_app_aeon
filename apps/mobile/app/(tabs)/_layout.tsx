import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0a0a0f', borderTopColor: '#222' },
        tabBarActiveTintColor: '#8b5cf6',
        tabBarInactiveTintColor: '#666',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Projects', tabBarLabel: 'Projects' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarLabel: 'Settings' }}
      />
    </Tabs>
  )
}
