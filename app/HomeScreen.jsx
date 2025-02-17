// HomeScreen.jsx
import React from "react";
import { View, Text, Button, StyleSheet } from "react-native";

const HomeScreen = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenue sur Poker App</Text>
      <Button
  title="JOUER"
  onPress={() => {
    console.log("Bouton JOUER pressé");
    navigation.navigate("Game");
  }}
/>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 }
});

export default HomeScreen;