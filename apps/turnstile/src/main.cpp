// Tek soru: röle DÜZENLİ olarak tıklıyor mu?
// 2 saniye tetik, 2 saniye boş. Tıklıyorsa aktif-low doğru.
#include <Arduino.h>
static const int IN1 = 18;
void setup() {
  Serial.begin(115200);
  pinMode(IN1, INPUT);
  delay(500);
  Serial.println("\n[test] aktif-LOW deneniyor: 2 sn tetik, 2 sn bos");
}
void loop() {
  pinMode(IN1, OUTPUT);
  digitalWrite(IN1, LOW);
  Serial.println("TETIK");
  delay(2000);
  pinMode(IN1, INPUT);
  Serial.println("bos");
  delay(2000);
}
