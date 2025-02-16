// PokerHomeScreen.jsx
import React from "react";
import {
  View,
  Text,
  Image,
  ImageBackground,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const PokerHomeScreen = () => {
  const router = useRouter();

  return (
    <ImageBackground
      source={{ uri: "https://i.imgur.com/U5yahsK.png" }} // Fond statique
      style={styles.container}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0.9)"]}
          style={styles.overlay}
        >
          {/* Logo agrandi */}
          <Image
            source={{ uri: "https://i.imgur.com/2CnW40P.png" }}
            style={styles.logo}
            resizeMode="contain"
          />

          {/* Texte du niveau */}
          <Text style={styles.level}>🔥 Niveau 3 🔥</Text>

          {/* Boutons côte à côte */}
          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push("/(tabs)/Game")}
            >
              <Ionicons name="play-circle" size={28} color="white" />
              <Text style={styles.buttonText}>JOUER</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.rulesButton]}
              onPress={() => router.push("/(tabs)/Game")}
            >
              <Ionicons name="book-outline" size={28} color="white" />
              <Text style={styles.buttonText}>RÈGLES DU JEU</Text>
            </TouchableOpacity>
          </View>

          {/* Barre de progression statique */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: "60%" }]} />
            <Text style={styles.progressText}>
              Vous faites partie des 60% de nos joueurs
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  safeArea: {
    flex: 1
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20
  },
  logo: {
    width: 400,
    height: 200,
    marginBottom: 20
  },
  level: {
    fontSize: 48,
    color: "#00aaff",
    fontWeight: "bold",
    marginBottom: 30,
    textShadowColor: "rgba(0, 170, 255, 0.7)",
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 10
  },
  buttonsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    paddingHorizontal: 20,
    marginBottom: 30
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#00aaff",
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 30,
    marginHorizontal: 10,
    shadowColor: "#00aaff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5
  },
  buttonText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginLeft: 10
  },
  rulesButton: {
    backgroundColor: "#005f99"
  },
  progressContainer: {
    width: "80%",
    height: 20,
    backgroundColor: "#444",
    borderRadius: 10,
    marginTop: 20,
    overflow: "hidden",
    alignSelf: "center"
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#00aaff"
  },
  progressText: {
    fontSize: 16,
    color: "#fff",
    marginTop: 5,
    textAlign: "center"
  }
});

export default PokerHomeScreen;