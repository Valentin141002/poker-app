import React from "react";
import { View, Text, StyleSheet } from "react-native";

const GameScreen = () => {
  return (
    <View style={styles.container}>
      <Text>Application chargée</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" }
});

export default GameScreen;
