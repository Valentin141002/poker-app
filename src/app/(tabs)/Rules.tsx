import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function RulesScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Règles du Poker 📜</Text>
      <Text style={styles.subtitle}>
        - Chaque joueur reçoit 2 cartes privées. {"\n"}
        - 5 cartes communes sont dévoilées progressivement. {"\n"}
        - Le but est d'obtenir la meilleure main possible. {"\n"}
        - Bluffez, misez et remportez le pot ! 💰
      </Text>
      <TouchableOpacity style={styles.button} onPress={() => router.push("/")}>
        <Text style={styles.buttonText}>Retour</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 10 },
  subtitle: { fontSize: 16, textAlign: "center", marginBottom: 20 },
  button: { backgroundColor: "#2a9d8f", padding: 15, borderRadius: 10 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});